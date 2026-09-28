import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { openSse } from '../events/sse.js';
import {
  AnalysisJobsService,
  TERMINAL_EVENTS,
  type AnalysisJob,
} from './analysis-jobs.service.js';
import { CcodeReviewService } from './code-review.service.js';

const LOG_PREFIX = '[code-review]';

type AuthedRequest = ExpressRequest & { user: AuthenticatedUser };

@Controller('/api/v1/code-review')
export class CodeReviewController {
  constructor(
    private readonly codeReviewService: CcodeReviewService,
    private readonly jobs: AnalysisJobsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('/repositories/:owner/:repo/pulls/:pullNumber/analyze')
  async analyzePullRequest(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
    @Query('postComments', new ParseBoolPipe({ optional: true }))
    postComments?: boolean,
  ) {
    console.log(
      `${LOG_PREFIX} analyze request: ${owner}/${repo} PR #${pullNumber} ` +
        `postComments=${postComments ? 'yes' : 'no'}`,
    );

    const payload = await this.jobs.buildPayload(
      req.user,
      owner,
      repo,
      pullNumber,
    );
    const result = await this.codeReviewService.analyzePR(
      req.user.userId,
      payload,
    );
    if (!postComments) {
      return result;
    }

    const review = await this.jobs.postComments(req.user, payload, result);
    return { ...result, review };
  }

  /**
   * Starts (or joins) a background analysis and streams its Server-Sent
   * Events: `started`, `run`, one `step` per finished graph node, `result`,
   * optional `review`, then `done` — or `error`. Disconnecting does not stop
   * the analysis; re-attach with `GET /runs/:runId/stream`.
   */
  @UseGuards(JwtAuthGuard)
  @Post('/repositories/:owner/:repo/pulls/:pullNumber/analyze/stream')
  analyzePullRequestStream(
    @Req() req: AuthedRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
    @Res() res: ExpressResponse,
    @Query('postComments', new ParseBoolPipe({ optional: true }))
    postComments?: boolean,
  ) {
    const job = this.jobs.start(
      req.user,
      owner,
      repo,
      pullNumber,
      Boolean(postComments),
    );
    this.pipeJob(job, req, res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/pulls/:pullNumber/runs')
  async listRuns(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
  ) {
    return this.codeReviewService.listRuns(
      req.user.userId,
      owner,
      repo,
      pullNumber,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/runs')
  async listUserRuns(
    @Request() req: { user: AuthenticatedUser },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('owner') owner?: string,
    @Query('repo') repo?: string,
  ) {
    return this.codeReviewService.listUserRuns(req.user.userId, {
      limit: Math.min(Math.max(limit, 1), 200),
      owner,
      repo,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('/runs/:runId')
  async getRun(
    @Request() req: { user: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    return this.codeReviewService.getRun(req.user.userId, runId);
  }

  /**
   * Re-attaches to a run's event stream: replays progress so far and follows
   * it live. Runs no longer in memory are answered from the database.
   */
  @UseGuards(JwtAuthGuard)
  @Get('/runs/:runId/stream')
  async attachRunStream(
    @Req() req: AuthedRequest,
    @Param('runId') runId: string,
    @Res() res: ExpressResponse,
  ) {
    const job = this.jobs.findByRun(req.user.userId, runId);
    if (job) {
      this.pipeJob(job, req, res);
      return;
    }

    const sse = openSse(res);
    try {
      const run = await this.codeReviewService.getRun(req.user.userId, runId);
      if (run.status === 'completed') {
        sse.send('run', {
          runId,
          startedAt: (run as { createdAt?: Date }).createdAt,
        });
        sse.send('result', {
          runId,
          rerunOf: run.rerunOf,
          ...(run.finalReport ?? {}),
        });
        sse.send('done', { runId });
      } else {
        sse.send('error', {
          status: 410,
          message: run.error ?? 'This analysis is no longer running.',
        });
      }
    } catch (error) {
      sse.send('error', {
        status: 404,
        message: error instanceof Error ? error.message : 'Run not found',
      });
    } finally {
      sse.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('/runs/:runId/cancel')
  cancelRun(
    @Request() req: { user: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    return { cancelled: this.jobs.cancel(req.user.userId, runId) };
  }

  /** Resolves the PR's open PReCision comments; the next analysis starts fresh. */
  @UseGuards(JwtAuthGuard)
  @Post('/runs/:runId/complete')
  async markRunComplete(
    @Request() req: { user: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    return this.codeReviewService.markComplete(req.user, runId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/stats')
  async getStats(@Request() req: { user: AuthenticatedUser }) {
    return this.codeReviewService.getStats(req.user.userId);
  }

  private pipeJob(job: AnalysisJob, req: ExpressRequest, res: ExpressResponse) {
    const sse = openSse(res);
    let finished = false;
    const unsubscribe = this.jobs.attach(job, ({ event, data }) => {
      sse.send(event, data);
      if (TERMINAL_EVENTS.has(event)) {
        finished = true;
        sse.end();
      }
    });
    if (finished) {
      unsubscribe();
      return;
    }
    req.on('close', () => {
      unsubscribe();
      sse.dispose();
    });
  }
}
