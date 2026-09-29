import { HttpException, Injectable, type OnModuleInit } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { EventsService } from '../events/events.service.js';
import { GithubService } from '../github/github.service.js';
import { CcodeReviewService } from './code-review.service.js';
import type { Finding, PRAnalysisPayload, PRFile } from './langgraph/state.js';

const LOG_PREFIX = '[code-review]';
/** Finished jobs stay replayable for a while so a refreshed page can still pick up the result. */
const FINISHED_JOB_TTL_MS = 10 * 60 * 1000;

export interface JobEvent {
  event: string;
  data: unknown;
}

type JobListener = (event: JobEvent) => void;

export interface AnalysisJob {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  postComments: boolean;
  startedAt: string;
  runId?: string;
  done: boolean;
  events: JobEvent[];
  listeners: Set<JobListener>;
  controller: AbortController;
}

export const TERMINAL_EVENTS = new Set(['done', 'error']);

/**
 * Runs analyses detached from the HTTP request that started them. Every
 * event is buffered so clients can disconnect (e.g. refresh) and re-attach
 * by run id, replaying progress so far and then following live.
 */
@Injectable()
export class AnalysisJobsService implements OnModuleInit {
  private readonly jobs = new Map<string, AnalysisJob>();
  private sequence = 0;

  constructor(
    private readonly githubService: GithubService,
    private readonly codeReviewService: CcodeReviewService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    this.events.registerSnapshot('analyses', (userId) =>
      [...this.jobs.values()]
        .filter((job) => job.userId === userId && !job.done && job.runId)
        .map((job) => this.describe(job)),
    );
  }

  /** Starts an analysis, or returns the one already running for the same PR. */
  start(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    pullNumber: number,
    postComments: boolean,
  ): AnalysisJob {
    const running = [...this.jobs.values()].find(
      (job) =>
        !job.done &&
        job.userId === user.userId &&
        job.owner === owner &&
        job.repo === repo &&
        job.pullNumber === pullNumber,
    );
    if (running) return running;

    const job: AnalysisJob = {
      id: `job-${Date.now()}-${++this.sequence}`,
      userId: user.userId,
      owner,
      repo,
      pullNumber,
      postComments,
      startedAt: new Date().toISOString(),
      done: false,
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    void this.execute(user, job);
    return job;
  }

  findByRun(userId: string, runId: string): AnalysisJob | undefined {
    return [...this.jobs.values()].find(
      (job) => job.userId === userId && job.runId === runId,
    );
  }

  /** Replays the job's events to `listener`, then follows it live until it finishes. */
  attach(job: AnalysisJob, listener: JobListener): () => void {
    for (const event of job.events) listener(event);
    if (job.done) return () => undefined;
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  cancel(userId: string, runId: string): boolean {
    const job = this.findByRun(userId, runId);
    if (!job || job.done) return false;
    job.controller.abort();
    return true;
  }

  async buildPayload(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<PRAnalysisPayload> {
    const pr = (await this.githubService.getPullRequest(
      user,
      owner,
      repo,
      pullNumber,
    )) as {
      number?: number;
      title?: string;
      body?: string;
      head?: { sha?: string; ref?: string };
      base?: { sha?: string; ref?: string };
    };

    const prFiles = (await this.githubService.listPullRequestFiles(
      user,
      owner,
      repo,
      pullNumber,
    )) as Array<{ filename?: string; patch?: string; status?: string }>;

    const headSha = pr?.head?.sha ?? '';
    const baseSha = pr?.base?.sha ?? '';
    const baseBranch = pr?.base?.ref ?? 'main';
    console.log(
      `${LOG_PREFIX} PR loaded: "${pr?.title ?? `PR #${pullNumber}`}" ` +
        `base=${baseBranch}@${baseSha.slice(0, 7)} head=${headSha.slice(0, 7)} ` +
        `prFiles=${prFiles.length}`,
    );

    const files: PRFile[] = await Promise.all(
      prFiles.map(async (file) => {
        const filename = file?.filename;
        if (!filename) {
          return null;
        }

        const patch =
          typeof file?.patch === 'string' && file.patch.trim().length > 0
            ? file.patch
            : '';

        const [content, baseContent] = await Promise.all([
          file.status === 'removed'
            ? Promise.resolve('')
            : this.fetchFileContent(user, owner, repo, filename, headSha),
          file.status === 'added'
            ? Promise.resolve('')
            : this.fetchFileContent(user, owner, repo, filename, baseSha),
        ]);

        return { filename, patch, content, baseContent } satisfies PRFile;
      }),
    ).then((results) =>
      results.filter((file): file is PRFile => file !== null),
    );

    console.log(
      `${LOG_PREFIX} payload ready: ${files.length} files for analysis`,
    );

    return {
      prId: pr?.number ?? pullNumber,
      title: pr?.title ?? `PR #${pullNumber}`,
      description: pr?.body ?? undefined,
      owner,
      repo,
      baseBranch,
      baseSha,
      headSha,
      files,
    };
  }

  postComments(
    user: AuthenticatedUser,
    payload: PRAnalysisPayload,
    result: Record<string, unknown>,
  ) {
    return this.codeReviewService.postReviewComments(
      user,
      String(result.runId),
      payload,
      Array.isArray(result.findings) ? (result.findings as Finding[]) : [],
      typeof result.overallSummary === 'string' ? result.overallSummary : '',
    );
  }

  private async execute(user: AuthenticatedUser, job: AnalysisJob) {
    let findings = 0;
    let failure: string | undefined;
    try {
      const payload = await this.buildPayload(
        user,
        job.owner,
        job.repo,
        job.pullNumber,
      );
      this.push(job, 'started', {
        title: payload.title,
        files: payload.files.length,
        baseBranch: payload.baseBranch,
        headSha: payload.headSha,
      });

      const result = await this.codeReviewService.analyzePR(
        user.userId,
        payload,
        (node) => this.push(job, 'step', { node, status: 'done' }),
        {
          signal: job.controller.signal,
          onRunCreated: (runId) => {
            job.runId = runId;
            this.push(job, 'run', { runId, startedAt: job.startedAt });
            this.events.emit(
              job.userId,
              'analysis.started',
              this.describe(job),
            );
          },
        },
      );
      const reported = (result as { findings?: unknown }).findings;
      findings = Array.isArray(reported) ? reported.length : 0;
      this.push(job, 'result', result);

      if (job.postComments) {
        this.push(
          job,
          'review',
          await this.postComments(user, payload, result),
        );
      }
      this.push(job, 'done', { runId: result.runId });
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Analysis failed';
      this.push(job, 'error', {
        status: error instanceof HttpException ? error.getStatus() : 500,
        message: failure,
      });
    } finally {
      job.done = true;
      job.listeners.clear();
      if (job.runId) {
        this.events.emit(job.userId, 'analysis.finished', {
          ...this.describe(job),
          status: failure ? 'failed' : 'completed',
          findings,
          error: failure,
        });
      }
      setTimeout(() => this.jobs.delete(job.id), FINISHED_JOB_TTL_MS).unref?.();
    }
  }

  private push(job: AnalysisJob, event: string, data: unknown) {
    const entry = { event, data };
    job.events.push(entry);
    for (const listener of job.listeners) {
      try {
        listener(entry);
      } catch {
        job.listeners.delete(listener);
      }
    }
  }

  private describe(job: AnalysisJob) {
    return {
      runId: job.runId,
      owner: job.owner,
      repo: job.repo,
      pullNumber: job.pullNumber,
      postComments: job.postComments,
      startedAt: job.startedAt,
    };
  }

  private async fetchFileContent(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string> {
    try {
      const filePayload = (await this.githubService.getRepositoryFile(
        user,
        owner,
        repo,
        path,
        ref,
      )) as { content?: string };

      return typeof filePayload.content === 'string' ? filePayload.content : '';
    } catch {
      return '';
    }
  }
}
