import {
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type.js';
import { IndexingService } from './indexing.service.js';

@Controller('/api/v1/repo-index')
export class IndexingController {
  constructor(private readonly indexingService: IndexingService) {}

  /** Branch index records created by the current user, newest first. */
  @UseGuards(JwtAuthGuard)
  @Get('/repositories')
  async listIndexedRepositories(@Request() req: { user: AuthenticatedUser }) {
    return this.indexingService.listForUser(req.user.userId);
  }

  /**
   * Starts indexing the branch in the background (registering the push webhook
   * first) and returns right away; progress arrives on `/api/v1/events/stream`.
   */
  @UseGuards(JwtAuthGuard)
  @Post('/repositories/:owner/:repo/branches/:branch/index')
  async indexRepository(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('branch') branch: string,
  ) {
    return this.indexingService.startFullIndex(req.user, owner, repo, branch);
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
