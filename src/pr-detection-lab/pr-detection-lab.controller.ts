import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PrDetectionLabService } from './pr-detection-lab.service.js';

/**
 * INTENTIONAL ISSUES — unauthenticated demo routes for PR analysis testing.
 * Remove this module after validating detection quality.
 */
@Controller('/api/v1/pr-detection-lab')
export class PrDetectionLabController {
  constructor(private readonly lab: PrDetectionLabService) {}

  // SECURITY: no auth guard on sensitive operations
  @Get('/users/query')
  buildQuery(@Query('userId') userId: string) {
    return { sql: this.lab.buildUserQuery(userId) };
  }

  // SECURITY: open redirect with no allowlist
  @Get('/redirect')
  redirect(@Query('next') next: string) {
    return { location: this.lab.resolveRedirect(next) };
  }

  // PERFORMANCE + BUG surface
  @Post('/orders/batch')
  async batchOrders(@Body() body: { userIds?: string[] }) {
    const userIds = body.userIds ?? [];
    return this.lab.loadOrdersForUsers(userIds);
  }

  @Post('/scores/average')
  average(@Body() body: { scores?: number[] }) {
    return { average: this.lab.averageScores(body.scores as number[]) };
  }

  // SECURITY: dumps secrets over HTTP with no auth
  @Get('/debug/config')
  debugConfig() {
    return this.lab.debugConfig();
  }

  @Post('/duplicates')
  duplicates(@Body() body: { items?: string[] }) {
    return { duplicates: this.lab.findDuplicates(body.items ?? []) };
  }

  @Post('/profile/email')
  profileEmail(
    @Body()
    body: {
      user?: { profile?: { email?: string; ssn?: string } } | null;
    },
  ) {
    return { email: this.lab.getProfileEmail(body.user ?? null) };
  }
}
