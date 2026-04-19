import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GithubModule } from '../github/github.module.js';
import { CodeReviewController } from './code-review.controller.js';
import { CcodeReviewService } from './code-review.service.js';

@Module({
  imports: [AuthModule, GithubModule],
  controllers: [CodeReviewController],
  providers: [CcodeReviewService],
})
export class CodeReviewModule {}

