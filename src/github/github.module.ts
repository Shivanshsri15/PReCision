import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GithubController } from './github.controller.js';
import { GithubService } from './github.service.js';

/**
 * GitHub OAuth + REST integration.
 * Depends on AuthModule for JWT (OAuth state), user persistence, and token encryption.
 */
@Module({
  imports: [AuthModule],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
