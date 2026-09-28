import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpException,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { GithubService } from '../github/github.service.js';
import type { Finding, PRAnalysisPayload, PRFile } from './langgraph/state.js';
import { CcodeReviewService } from './code-review.service.js';

const LOG_PREFIX = '[code-review]';

async function fetchFileContent(
  githubService: GithubService,
  user: AuthenticatedUser,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  try {
    const filePayload = (await githubService.getRepositoryFile(
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

@Controller('/api/v1/code-review')
export class CodeReviewController {
  constructor(
    private readonly githubService: GithubService,
    private readonly codeReviewService: CcodeReviewService,
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

    const payload = await this.buildPayload(req.user, owner, repo, pullNumber);
    const result = await this.codeReviewService.analyzePR(req.user.userId, payload);
    if (!postComments) {
      return result;
    }

    const review = await this.postComments(req.user, payload, result);
    return { ...result, review };
  }

  /**
   * Same as `analyze`, but streams Server-Sent Events while the pipeline runs:
   * `started`, one `step` per finished graph node, `result`, optional `review`,
   * then `done` — or `error` on failure.
   */
  @UseGuards(JwtAuthGuard)
  @Post('/repositories/:owner/:repo/pulls/:pullNumber/analyze/stream')
  async analyzePullRequestStream(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
    @Res() res: ExpressResponse,
    @Query('postComments', new ParseBoolPipe({ optional: true }))
    postComments?: boolean,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const payload = await this.buildPayload(req.user, owner, repo, pullNumber);
      send('started', {
        title: payload.title,
        files: payload.files.length,
        baseBranch: payload.baseBranch,
        headSha: payload.headSha,
      });

      const result = await this.codeReviewService.analyzePR(
        req.user.userId,
        payload,
        (node) => send('step', { node, status: 'done' }),
      );
      send('result', result);

      if (postComments) {
        send('review', await this.postComments(req.user, payload, result));
      }
      send('done', { runId: result.runId });
    } catch (error) {
      send('error', {
        status: error instanceof HttpException ? error.getStatus() : 500,
        message: error instanceof Error ? error.message : 'Analysis failed',
      });
    } finally {
      res.end();
    }
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

  private postComments(
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

  private async buildPayload(
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
            : fetchFileContent(this.githubService, user, owner, repo, filename, headSha),
          file.status === 'added'
            ? Promise.resolve('')
            : fetchFileContent(this.githubService, user, owner, repo, filename, baseSha),
        ]);

        console.log(
          `${LOG_PREFIX} file prepared: ${filename} ` +
            `patch=${patch.length} chars head=${content.length} chars base=${baseContent.length} chars`,
        );

        return { filename, patch, content, baseContent } satisfies PRFile;
      }),
    ).then((results) => results.filter((file): file is PRFile => file !== null));

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
}
