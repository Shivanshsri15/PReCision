import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { GithubService } from '../github/github.service.js';
import type { PRAnalysisPayload, PRFile } from './langgraph/state.js';
import { CcodeReviewService } from './code-review.service.js';
import { AnalyzePrDto } from './dto/analyze-pr.dto.js';

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
    @Body() body: AnalyzePrDto,
  ) {
    const maxFiles = body.maxFiles ?? 5;

    const pr = (await this.githubService.getPullRequest(
      req.user,
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
      req.user,
      owner,
      repo,
      pullNumber,
    )) as Array<{ filename?: string; patch?: string; status?: string }>;

    const headSha = pr?.head?.sha ?? '';
    const baseSha = pr?.base?.sha ?? '';
    const baseBranch = pr?.base?.ref ?? 'main';

    const files: PRFile[] = [];
    for (const file of prFiles.slice(0, maxFiles)) {
      const filename = file?.filename;
      if (!filename) {
        continue;
      }

      const patch =
        typeof file?.patch === 'string' && file.patch.trim().length > 0
          ? file.patch
          : '';

      const content =
        file.status === 'removed'
          ? ''
          : await fetchFileContent(
              this.githubService,
              req.user,
              owner,
              repo,
              filename,
              headSha,
            );

      const baseContent =
        file.status === 'added'
          ? ''
          : await fetchFileContent(
              this.githubService,
              req.user,
              owner,
              repo,
              filename,
              baseSha,
            );

      files.push({ filename, patch, content, baseContent });
    }

    const payload: PRAnalysisPayload = {
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

    return this.codeReviewService.analyzePR(req.user.userId, payload);
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
}
