import { Body, Controller, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { GithubService } from '../github/github.service.js';
import type { PRAnalysisPayload, PRFile } from './langgraph/state.js';
import { CcodeReviewService } from './code-review.service.js';
import { AnalyzePrDto } from './dto/analyze-pr.dto.js';

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
    const includeContent = body.includeContent ?? true;

    const pr = (await this.githubService.getPullRequest(
      req.user,
      owner,
      repo,
      pullNumber,
    )) as any;

    const prFiles = (await this.githubService.listPullRequestFiles(
      req.user,
      owner,
      repo,
      pullNumber,
    )) as any[];
    const headSha: string | undefined = pr?.head?.sha;
    const files: PRFile[] = [];
    for (const f of prFiles) {
      const filename: string | undefined = f?.filename;
      if (!filename) continue;

      const patch: string | undefined =
        typeof f?.patch === 'string' && f.patch.trim().length > 0 ? f.patch : undefined;

      let content: string | undefined;
      if (!patch && includeContent && headSha && f?.status !== 'removed') {
        try {
          const filePayload = (await this.githubService.getRepositoryFile(
            req.user,
            owner,
            repo,
            filename,
            headSha,
          )) as any;
          if (typeof filePayload?.content === 'string' && filePayload.content.trim()) {
            content = filePayload.content;
          }
        } catch {
          // If we can't fetch content (e.g. file renamed/binary), we still proceed with what we have.
        }
      }

      files.push({ filename, patch, content });
    }
    const payload: PRAnalysisPayload = {
      prId: pr?.number ?? pullNumber,
      title: pr?.title ?? `PR #${pullNumber}`,
      description: pr?.body ?? undefined,
      files,
      extraPrompt: body.extraPrompt?.trim() || undefined,
    };
    return this.codeReviewService.analyzePR(payload);
  }
}

