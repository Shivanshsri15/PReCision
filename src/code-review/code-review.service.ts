import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GeminiKeyService } from '../auth/gemini-key.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { GithubService } from '../github/github.service.js';
import { RetrieverService } from '../repo-rag/retrieval/retriever.service.js';
import {
  CodeReviewRun,
  type CodeReviewRunDocument,
} from './schemas/code-review-run.schema.js';
import { buildGraph } from './langgraph/graph.js';
import { parsePatchHunks } from './langgraph/node/patch-hunks.js';
import type { Finding, PRAnalysisPayload } from './langgraph/state.js';

const LOG_PREFIX = '[code-review]';

export interface PostedReview {
  posted: boolean;
  inlineComments: number;
  summaryOnly: number;
  url?: string;
  error?: string;
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
export class CcodeReviewService {
  constructor(
    private readonly retrieverService: RetrieverService,
    private readonly githubService: GithubService,
    private readonly geminiKeyService: GeminiKeyService,
    @InjectModel(CodeReviewRun.name)
    private readonly codeReviewRunModel: Model<CodeReviewRunDocument>,
  ) {}

  /**
   * Posts findings as one GitHub review: inline comments for findings on a
   * diff line, and the rest listed in the review body.
   */
  async postReviewComments(
    user: AuthenticatedUser,
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
    const summaryOnly: Finding[] = [];
    for (const finding of findings) {
      if (finding.line && commentable.get(finding.file)?.has(finding.line)) {
        comments.push({ path: finding.file, line: finding.line, body: formatFinding(finding) });
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

    try {
      const review = await this.githubService.createPullRequestReview(
        user,
        payload.owner,
        payload.repo,
        payload.prId,
        { commitId: payload.headSha, body: bodyParts.join('\n\n'), comments },
      );
      console.log(
        `${LOG_PREFIX} review posted: ${payload.owner}/${payload.repo} PR #${payload.prId} ` +
          `inline=${comments.length} summaryOnly=${summaryOnly.length}`,
      );
      return {
        posted: true,
        inlineComments: comments.length,
        summaryOnly: summaryOnly.length,
        url: review.html_url,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} review post failed: PR #${payload.prId} — ${message}`);
      return {
        posted: false,
        inlineComments: 0,
        summaryOnly: summaryOnly.length,
        error: message,
      };
    }
  }

  async analyzePR(userId: string, payload: PRAnalysisPayload) {
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

    const run = await this.codeReviewRunModel.create({
      userId: new Types.ObjectId(userId),
      owner: payload.owner,
      repo: payload.repo,
      pullNumber: payload.prId,
      baseSha: payload.baseSha,
      headSha: payload.headSha,
      baseBranch: payload.baseBranch,
      status: 'running',
    });

    try {
      console.log(
        `${LOG_PREFIX} graph invoke started: runId=${run._id} ` +
          `pipeline=inputGuard→retriever→[quality|security|performance]→join→bugDetection→assembler`,
      );
      const graph = buildGraph(this.retrieverService);
      const result = await graph.invoke(
        { input: payload },
        { configurable: { geminiApiKey } },
      );
      const finalReport = result.finalReport ?? {
        prId: payload.prId,
        overallSummary: 'Review completed.',
        findings: [],
        domainReports: {},
      };

      const findingsCount = Array.isArray(finalReport.findings)
        ? finalReport.findings.length
        : 0;
      const relatedContextCount =
        typeof finalReport.relatedContextCount === 'number'
          ? finalReport.relatedContextCount
          : (result.relatedContext?.length ?? 0);
      console.log(
        `${LOG_PREFIX} graph complete: runId=${run._id} ` +
          `findings=${findingsCount} relatedContext=${relatedContextCount}`,
      );

      await this.codeReviewRunModel.findByIdAndUpdate(run._id, {
        status: 'completed',
        finalReport,
      });

      return {
        runId: String(run._id),
        ...finalReport,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed';
      console.error(
        `${LOG_PREFIX} analyze failed: ${repoId} PR #${payload.prId} runId=${run._id} — ${message}`,
      );
      await this.codeReviewRunModel.findByIdAndUpdate(run._id, {
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  async listRuns(
    userId: string,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
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
}
