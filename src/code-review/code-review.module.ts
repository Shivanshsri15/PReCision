import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { GithubModule } from '../github/github.module.js';
import { RepoRagModule } from '../repo-rag/repo-rag.module.js';
import { CodeReviewController } from './code-review.controller.js';
import { CcodeReviewService } from './code-review.service.js';
import {
  CodeReviewRun,
  CodeReviewRunSchema,
} from './schemas/code-review-run.schema.js';

@Module({
  imports: [
    AuthModule,
    GithubModule,
    RepoRagModule,
    MongooseModule.forFeature([
      { name: CodeReviewRun.name, schema: CodeReviewRunSchema },
    ]),
  ],
  controllers: [CodeReviewController],
  providers: [CcodeReviewService],
})
export class CodeReviewModule {}
