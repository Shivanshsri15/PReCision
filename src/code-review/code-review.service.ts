import {
  BadRequestException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GeminiKeyService } from '../auth/gemini-key.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { GithubService } from '../github/github.service.js';
import { IndexingService } from '../repo-rag/indexing/indexing.service.js';
import { RetrieverService } from '../repo-rag/retrieval/retriever.service.js';
import {
  CodeReviewRun,
  type CodeReviewRunDocument,
  type ContextCache,
  type PostedComment,
} from './schemas/code-review-run.schema.js';
import { buildGraph } from './langgraph/graph.js';
import { parsePatchHunks } from './langgraph/node/patch-hunks.js';
import type { Finding, PRAnalysisPayload, RetrievedChunk } from './langgraph/state.js';

const LOG_PREFIX = '[code-review]';
const STALE_RUN_MS = 30 * 60 * 1000;

export interface PostedReview {
  posted: boolean;
  inlineComments: number;
  summaryOnly: number;
  /** Comments from earlier runs on this PR that were marked resolved. */
  resolvedPrevious: number;
  url?: string;
  error?: string;
}

interface PrRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

function formatFinding(finding: Finding): string {
  const lines = [
    `**Severity:** ${finding.severity.toUpperCase()}`,
    `**Issue:** ${finding.issue}`,
  ];
  if (finding.suggestion) {
    lines.push(`**Suggestion:** ${finding.suggestion}`);
  }
  return lines.join('\n\n');
}

@Injectable()
export class CcodeReviewService implements OnModuleInit {
  constructor(
    private readonly retrieverService: RetrieverService,
    private readonly githubService: GithubService,
    private readonly geminiKeyService: GeminiKeyService,
    private readonly indexingService: IndexingService,
    @InjectModel(CodeReviewRun.name)
    private readonly codeReviewRunModel: Model<CodeReviewRunDocument>,
  ) {}

  /** Analyses run in-process, so any run still `running` at boot was cut off by a restart. */
  async onModuleInit() {
    const { modifiedCount } = await this.codeReviewRunModel.updateMany(
      { status: 'running' },
      { status: 'failed', error: 'Interrupted: the server restarted before the analysis finished.' },
    );
    if (modifiedCount) {
      console.log(`${LOG_PREFIX} marked ${modifiedCount} interrupted run(s) as failed`);
    }
  }

  private async failStaleRuns(userId: string) {
    await this.codeReviewRunModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        status: 'running',
        updatedAt: { $lt: new Date(Date.now() - STALE_RUN_MS) },
      },
      { status: 'failed', error: 'Interrupted: the analysis stopped responding.' },
    );
  }

  /**
   * Posts findings as one GitHub review: inline comments for findings on a
   * diff line, and the rest listed in the review body. Afterwards every
   * comment posted by earlier runs on this PR is marked resolved.
   */
  async postReviewComments(
    user: AuthenticatedUser,
    runId: string,
    payload: PRAnalysisPayload,
    findings: Finding[],
    summary: string,
  ): Promise<PostedReview> {
    const commentable = new Map(
      payload.files.map((file) => [
        file.filename,
        parsePatchHunks(file.patch).commentableLines,
      ]),
    );

    const comments: Array<{ path: string; line: number; body: string }> = [];
    const inlineFindings: Finding[] = [];
    const summaryOnly: Finding[] = [];
    for (const finding of findings) {
      if (finding.line && commentable.get(finding.file)?.has(finding.line)) {
        comments.push({ path: finding.file, line: finding.line, body: formatFinding(finding) });
        inlineFindings.push(finding);
      } else {
        summaryOnly.push(finding);
      }
    }

    const bodyParts = [`## PReCision review\n\n${summary}`];
    if (summaryOnly.length) {
      bodyParts.push(
        '### Findings not on a diff line\n\n' +
          summaryOnly
            .map((f) => `- \`${f.file}${f.line ? `:${f.line}` : ''}\` **${f.severity.toUpperCase()}**: ${f.issue}${f.suggestion ? `\n  - Suggestion: ${f.suggestion}` : ''}`)
            .join('\n'),
      );
    }

    let review: { id: number; html_url: string };
    try {
      review = await this.githubService.createPullRequestReview(
        user,
        payload.owner,
        payload.repo,
        payload.prId,
        { commitId: payload.headSha, body: bodyParts.join('\n\n'), comments },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} review post failed: PR #${payload.prId} — ${message}`);
      return {
        posted: false,
        inlineComments: 0,
        summaryOnly: summaryOnly.length,
        resolvedPrevious: 0,
        error: message,
      };
    }

    const commentIds = await this.mapCommentIds(user, payload, review.id, comments.length);
    const postedComments: PostedComment[] = [...inlineFindings, ...summaryOnly].map((finding) => ({
      commentId: finding.line ? commentIds.get(`${finding.file}:${finding.line}`) : undefined,
      file: finding.file,
      line: finding.line,
      issue: finding.issue,
      severity: finding.severity,
      resolved: false,
    }));
    await this.codeReviewRunModel.findByIdAndUpdate(runId, {
      postedComments,
      reviewUrl: review.html_url,
    });

    const resolvedPrevious = await this.resolveOpenComments(
      user,
      { owner: payload.owner, repo: payload.repo, pullNumber: payload.prId },
      `**Resolved**: superseded by a new PReCision review of \`${payload.headSha.slice(0, 7)}\`.`,
      runId,
    );

    console.log(
      `${LOG_PREFIX} review posted: ${payload.owner}/${payload.repo} PR #${payload.prId} ` +
        `inline=${comments.length} summaryOnly=${summaryOnly.length} resolvedPrevious=${resolvedPrevious}`,
    );
    return {
      posted: true,
      inlineComments: comments.length,
      summaryOnly: summaryOnly.length,
      resolvedPrevious,
      url: review.html_url,
    };
  }

  /**
   * Marks a run complete and resolves every open PReCision comment on its PR.
   * The next analysis of the PR then starts fresh instead of re-running.
   */
  async markComplete(user: AuthenticatedUser, runId: string) {
    const run = await this.findOwnedRun(user.userId, runId);
    if (run.status !== 'completed') {
      throw new BadRequestException('Only a finished analysis can be marked complete');
    }

    const resolved = await this.resolveOpenComments(
      user,
      run,
      '**Resolved**: the PReCision review was marked complete.',
    );
    console.log(
      `${LOG_PREFIX} run marked complete: runId=${runId} resolvedComments=${resolved}`,
    );

    return this.codeReviewRunModel
      .findByIdAndUpdate(
        runId,
        { markedComplete: true, markedCompleteAt: new Date() },
        { new: true },
      )
      .lean();
  }

  /**
   * Runs the review graph. `onStep` is called whenever a graph node finishes,
   * which lets the streaming endpoint report live pipeline progress.
   *
   * If the PR's latest finished run isn't marked complete, this is a re-run:
   * that run's cached RAG context is reused (the retriever is skipped) and its
   * findings are given to the reviewers to re-check.
   */
  async analyzePR(
    userId: string,
    payload: PRAnalysisPayload,
    onStep?: (node: string) => void,
    options: { onRunCreated?: (runId: string) => void; signal?: AbortSignal } = {},
  ) {
    const repoId = `${payload.owner}/${payload.repo}`;
    console.log(
      `${LOG_PREFIX} analyze started: ${repoId} PR #${payload.prId} ` +
        `base=${payload.baseBranch}@${payload.baseSha.slice(0, 7)} ` +
        `head=${payload.headSha.slice(0, 7)} files=${payload.files.length}`,
    );

    await this.retrieverService.ensureIndexed(
      payload.owner,
      payload.repo,
      payload.baseBranch,
    );
    console.log(`${LOG_PREFIX} index verified for ${repoId}@${payload.baseBranch}`);

    const geminiApiKey = await this.geminiKeyService.resolve(userId);

    const previous = await this.codeReviewRunModel
      .findOne({
        userId: new Types.ObjectId(userId),
        owner: payload.owner,
        repo: payload.repo,
        pullNumber: payload.prId,
        status: 'completed',
      })
      .select('+contextCache')
      .sort({ createdAt: -1 })
      .lean();
    const rerunOf = previous && !previous.markedComplete ? previous : null;
    const previousFindings = Array.isArray(rerunOf?.finalReport?.findings)
      ? (rerunOf.finalReport.findings as Finding[])
      : [];
    const cachedContext = rerunOf?.contextCache;

    const run = await this.codeReviewRunModel.create({
      userId: new Types.ObjectId(userId),
      owner: payload.owner,
      repo: payload.repo,
      pullNumber: payload.prId,
      baseSha: payload.baseSha,
      headSha: payload.headSha,
      baseBranch: payload.baseBranch,
      status: 'running',
      rerunOf: rerunOf ? String(rerunOf._id) : undefined,
    });
    options.onRunCreated?.(String(run._id));

    try {
      console.log(
        `${LOG_PREFIX} graph invoke started: runId=${run._id} ` +
          (rerunOf
            ? `rerunOf=${String(rerunOf._id)} previousFindings=${previousFindings.length} ` +
              `cachedContext=${cachedContext ? 'yes' : 'no'}`
            : 'fresh analysis'),
      );
      const graph = buildGraph(this.retrieverService);
      const stream = await graph.stream(
        {
          input: payload,
          previousFindings: previousFindings.length ? previousFindings : undefined,
          relatedContext: cachedContext?.chunks,
          relatedContextFormatted: cachedContext?.formatted,
        },
        { configurable: { geminiApiKey }, streamMode: 'updates', signal: options.signal },
      );

      let assembledReport: Record<string, unknown> | undefined;
      let context: ContextCache | undefined = cachedContext;
      for await (const chunk of stream) {
        for (const [node, update] of Object.entries(
          chunk as Record<
            string,
            | {
                finalReport?: Record<string, unknown>;
                relatedContext?: RetrievedChunk[];
                relatedContextFormatted?: string;
              }
            | undefined
          >,
        )) {
          if (update?.finalReport) {
            assembledReport = update.finalReport;
          }
          if (update?.relatedContextFormatted !== undefined) {
            context = {
              chunks: update.relatedContext ?? [],
              formatted: update.relatedContextFormatted,
            };
          }
          onStep?.(node);
        }
      }

      const finalReport = assembledReport ?? {
        prId: payload.prId,
        overallSummary: 'Review completed.',
        findings: [],
        domainReports: {},
      };

      const findingsCount = Array.isArray(finalReport.findings)
        ? finalReport.findings.length
        : 0;
      console.log(
        `${LOG_PREFIX} graph complete: runId=${run._id} ` +
          `findings=${findingsCount} relatedContext=${String(finalReport.relatedContextCount ?? 0)}`,
      );

      await this.codeReviewRunModel.findByIdAndUpdate(run._id, {
        status: 'completed',
        finalReport,
        contextCache: context,
      });

      return {
        runId: String(run._id),
        rerunOf: rerunOf ? String(rerunOf._id) : undefined,
        ...finalReport,
      };
    } catch (error) {
      const message = options.signal?.aborted
        ? 'Cancelled by user.'
        : error instanceof Error
          ? error.message
          : 'Analysis failed';
      console.error(
        `${LOG_PREFIX} analyze failed: ${repoId} PR #${payload.prId} runId=${run._id} — ${message}`,
      );
      await this.codeReviewRunModel.findByIdAndUpdate(run._id, {
        status: 'failed',
        error: message,
      });
      throw options.signal?.aborted ? new Error(message) : error;
    }
  }

  async listRuns(
    userId: string,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    await this.failStaleRuns(userId);
    return this.codeReviewRunModel
      .find({
        userId: new Types.ObjectId(userId),
        owner,
        repo,
        pullNumber,
      })
      .sort({ createdAt: -1 })
      .lean();
  }

  /** All of the user's runs, newest first, without the full findings payload. */
  async listUserRuns(
    userId: string,
    filters: { limit: number; owner?: string; repo?: string },
  ) {
    const query: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (filters.owner) query.owner = filters.owner;
    if (filters.repo) query.repo = filters.repo;

    await this.failStaleRuns(userId);
    return this.codeReviewRunModel
      .find(query)
      .select(
        'owner repo pullNumber status baseSha headSha baseBranch error createdAt updatedAt ' +
          'markedComplete markedCompleteAt rerunOf reviewUrl ' +
          'finalReport.counts finalReport.overallSummary',
      )
      .sort({ createdAt: -1 })
      .limit(filters.limit)
      .lean();
  }

  async getRun(userId: string, runId: string) {
    return this.findOwnedRun(userId, runId);
  }

  async getStats(userId: string) {
    const [runStats, indexed] = await Promise.all([
      this.codeReviewRunModel.aggregate<{
        reviews: number;
        completed: number;
        high: number;
        medium: number;
        low: number;
      }>([
        { $match: { userId: new Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            reviews: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            high: { $sum: { $ifNull: ['$finalReport.counts.severity.high', 0] } },
            medium: { $sum: { $ifNull: ['$finalReport.counts.severity.medium', 0] } },
            low: { $sum: { $ifNull: ['$finalReport.counts.severity.low', 0] } },
          },
        },
      ]),
      this.indexingService.listForUser(userId),
    ]);

    const totals = runStats[0] ?? { reviews: 0, completed: 0, high: 0, medium: 0, low: 0 };
    return {
      repositories: new Set(indexed.map((record) => record.repoId)).size,
      indexedBranches: indexed.length,
      indexedChunks: indexed.reduce((sum, record) => sum + (record.chunkCount ?? 0), 0),
      indexedFiles: indexed.reduce((sum, record) => sum + (record.fileCount ?? 0), 0),
      reviews: totals.reviews,
      completedReviews: totals.completed,
      findings: totals.high + totals.medium + totals.low,
      severity: { high: totals.high, medium: totals.medium, low: totals.low },
    };
  }

  private async findOwnedRun(userId: string, runId: string) {
    if (!Types.ObjectId.isValid(runId)) {
      throw new NotFoundException('Run not found');
    }
    const run = await this.codeReviewRunModel
      .findOne({ _id: runId, userId: new Types.ObjectId(userId) })
      .lean();
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    return run;
  }

  private async mapCommentIds(
    user: AuthenticatedUser,
    payload: PRAnalysisPayload,
    reviewId: number,
    inlineCount: number,
  ): Promise<Map<string, number>> {
    if (!inlineCount) return new Map();
    try {
      const posted = await this.githubService.listReviewComments(
        user,
        payload.owner,
        payload.repo,
        payload.prId,
        reviewId,
      );
      return new Map(
        posted.map((comment) => [`${comment.path}:${comment.line ?? comment.original_line}`, comment.id]),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${LOG_PREFIX} could not load review comment ids: ${message}`);
      return new Map();
    }
  }

  /**
   * Replies `replyBody` in the thread of every unresolved comment posted by the
   * user's runs on this PR (optionally except one run) and marks them resolved.
   */
  private async resolveOpenComments(
    user: AuthenticatedUser,
    pr: PrRef,
    replyBody: string,
    exceptRunId?: string,
  ): Promise<number> {
    const runs = await this.codeReviewRunModel
      .find({
        userId: new Types.ObjectId(user.userId),
        owner: pr.owner,
        repo: pr.repo,
        pullNumber: pr.pullNumber,
        ...(exceptRunId ? { _id: { $ne: new Types.ObjectId(exceptRunId) } } : {}),
        postedComments: { $elemMatch: { resolved: false } },
      })
      .select('postedComments')
      .lean();

    let resolvedCount = 0;
    for (const run of runs) {
      const resolvedAt = new Date();
      const comments = await Promise.all(
        (run.postedComments ?? []).map(async (comment) => {
          if (comment.resolved) return comment;
          resolvedCount += 1;
          if (comment.commentId) {
            await this.githubService
              .replyToReviewComment(
                user,
                pr.owner,
                pr.repo,
                pr.pullNumber,
                comment.commentId,
                replyBody,
              )
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`${LOG_PREFIX} resolve reply failed for comment ${comment.commentId}: ${message}`);
              });
          }
          return { ...comment, resolved: true, resolvedAt };
        }),
      );
      await this.codeReviewRunModel.findByIdAndUpdate(run._id, { postedComments: comments });
    }
    return resolvedCount;
  }
}
