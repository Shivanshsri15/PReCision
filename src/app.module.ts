import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { envValidationSchema } from './config/env.validation.js';
import { AuthModule } from './auth/auth.module.js';
import { GithubModule } from './github/github.module.js';
import { CodeReviewModule } from './code-review/code-review.module.js';
import { RepoRagModule } from './repo-rag/repo-rag.module.js';
import { PrDetectionLabModule } from './pr-detection-lab/pr-detection-lab.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    AuthModule,
    GithubModule,
    RepoRagModule,
    CodeReviewModule,
    // TEMP: intentional issues for PR analysis detection testing — remove after test
    PrDetectionLabModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
