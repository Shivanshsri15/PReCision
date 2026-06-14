import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import type { FileChunk, RetrievedChunk, VectorDocument } from '../types/chunk.types.js';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private collection!: any;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  onModuleInit() {
    const db = this.connection.db;
    if (!db) {
      throw new Error('MongoDB connection is not ready');
    }
    this.collection = db.collection('repo_vectors');
  }

  async upsertChunks(
    repoId: string,
    branch: string,
    path: string,
    blobSha: string,
    chunks: FileChunk[],
    embeddings: number[][],
  ): Promise<void> {
    await this.deletePath(repoId, branch, path);

    if (chunks.length === 0) {
      return;
    }

    const docs: VectorDocument[] = chunks.map((chunk, index) => ({
      repoId,
      branch,
      path,
      blobSha,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      embedding: embeddings[index] ?? [],
    }));

    await this.collection.insertMany(docs);
  }

  async deletePath(repoId: string, branch: string, path: string): Promise<void> {
    await this.collection.deleteMany({ repoId, branch, path });
  }

  async query(
    embedding: number[],
    repoId: string,
    branch: string,
    k: number,
    excludePaths: string[] = [],
  ): Promise<RetrievedChunk[]> {
    const vectorStore = this.createVectorStore();

    const results = await vectorStore.similaritySearchVectorWithScore(
      embedding,
      k,
      {
        preFilter: {
          repoId: { $eq: repoId },
          branch: { $eq: branch },
        },
      },
    );

    const excluded = new Set(excludePaths.map(normalizePath));

    return results
      .map(([doc, score]) => {
        const path = String(doc.metadata?.path ?? '');
        return {
          path,
          startLine: Number(doc.metadata?.startLine ?? 0),
          endLine: Number(doc.metadata?.endLine ?? 0),
          text: doc.pageContent,
          source: `vector:${score.toFixed(4)}`,
        } satisfies RetrievedChunk;
      })
      .filter((chunk) => chunk.path && !excluded.has(normalizePath(chunk.path)));
  }

  async queryByPathPrefix(
    repoId: string,
    branch: string,
    prefix: string,
    limit: number,
    excludePaths: string[] = [],
  ): Promise<RetrievedChunk[]> {
    const excluded = new Set(excludePaths.map(normalizePath));
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const docs = await this.collection
      .find({
        repoId,
        branch,
        path: { $regex: `^${escaped}` },
      })
      .limit(limit * 2)
      .toArray();

    return docs
      .filter((doc) => !excluded.has(normalizePath(String(doc.path))))
      .slice(0, limit)
      .map((doc) => ({
        path: String(doc.path),
        startLine: Number(doc.startLine ?? 0),
        endLine: Number(doc.endLine ?? 0),
        text: String(doc.text ?? ''),
        source: 'path-prefix',
      }));
  }

  async queryByPathPattern(
    repoId: string,
    branch: string,
    pattern: RegExp,
    limit: number,
    excludePaths: string[] = [],
  ): Promise<RetrievedChunk[]> {
    const excluded = new Set(excludePaths.map(normalizePath));

    const docs = await this.collection
      .find({
        repoId,
        branch,
        path: { $regex: pattern },
      })
      .limit(limit * 2)
      .toArray();

    return docs
      .filter((doc) => !excluded.has(normalizePath(String(doc.path))))
      .slice(0, limit)
      .map((doc) => ({
        path: String(doc.path),
        startLine: Number(doc.startLine ?? 0),
        endLine: Number(doc.endLine ?? 0),
        text: String(doc.text ?? ''),
        source: 'path-pattern',
      }));
  }

  async getChunksForPath(
    repoId: string,
    branch: string,
    path: string,
  ): Promise<RetrievedChunk[]> {
    const docs = await this.collection
      .find({ repoId, branch, path })
      .sort({ startLine: 1 })
      .toArray();

    return docs.map((doc) => ({
      path: String(doc.path),
      startLine: Number(doc.startLine ?? 0),
      endLine: Number(doc.endLine ?? 0),
      text: String(doc.text ?? ''),
      source: 'import-graph',
    }));
  }

  async countChunks(repoId: string, branch: string): Promise<number> {
    return this.collection.countDocuments({ repoId, branch });
  }

  private createVectorStore() {
    return new MongoDBAtlasVectorSearch(
      this.embeddingsService.getQueryEmbeddingsModel(),
      {
        collection: this.collection as any,
        indexName: this.config.getOrThrow<string>('VECTOR_INDEX_NAME'),
        textKey: 'text',
        embeddingKey: 'embedding',
      },
    );
  }
}

export function normalizePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}
