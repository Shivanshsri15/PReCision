import {
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
  ) {
    console.log(
      `${LOG_PREFIX} analyze request: ${owner}/${repo} PR #${pullNumber}`,
    );

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
            : fetchFileContent(
                this.githubService,
                req.user,
                owner,
                repo,
                filename,
                headSha,
              ),
          file.status === 'added'
            ? Promise.resolve('')
            : fetchFileContent(
                this.githubService,
                req.user,
                owner,
                repo,
                filename,
                baseSha,
              ),
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
