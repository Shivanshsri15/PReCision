import { Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type.js';
import { IndexingService } from './indexing.service.js';

@Controller('/api/v1/repo-index')
export class IndexingController {
  constructor(private readonly indexingService: IndexingService) {}

  /** Registers the repo push webhook (GITHUB_WEBHOOK_URL) first, then indexes the branch. */
  @UseGuards(JwtAuthGuard)
  @Post('/repositories/:owner/:repo/branches/:branch/index')
  async indexRepository(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('branch') branch: string,
  ) {
    return this.indexingService.runFullIndex(req.user, owner, repo, branch);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/branches/:branch/status')
  async getIndexStatus(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('branch') branch: string,
  ) {
    return this.indexingService.getStatus(owner, repo, branch);
  }
}
