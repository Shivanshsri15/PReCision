import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { GithubModule } from '../github/github.module.js';
import { EmbeddingsService } from './embeddings/embeddings.service.js';
import { IndexingController } from './indexing/indexing.controller.js';
import { IndexingService } from './indexing/indexing.service.js';
import { RetrieverService } from './retrieval/retriever.service.js';
import { RepoIndex, RepoIndexSchema } from './schemas/repo-index.schema.js';
import { VectorStoreService } from './vector-store/vector-store.service.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => GithubModule),
    MongooseModule.forFeature([{ name: RepoIndex.name, schema: RepoIndexSchema }]),
  ],
  controllers: [IndexingController],
  providers: [
    EmbeddingsService,
    VectorStoreService,
    IndexingService,
    RetrieverService,
  ],
  exports: [
    EmbeddingsService,
    VectorStoreService,
    IndexingService,
    RetrieverService,
  ],
})
export class RepoRagModule {}
