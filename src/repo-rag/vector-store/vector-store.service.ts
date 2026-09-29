import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import type {
  FileChunk,
  RetrievedChunk,
  VectorDocument,
} from '../types/chunk.types.js';

type VectorCollection = ReturnType<NonNullable<Connection['db']>['collection']>;

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private collection!: VectorCollection;

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
    // Path lookups during retrieval and re-indexing filter on these fields.
    void this.collection
      .createIndex({ repoId: 1, branch: 1, path: 1, startLine: 1 })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[vector-store] could not ensure path index: ${message}`);
      });
  }

  /**
   * Chunks for many paths in one round trip (without embedding vectors),
   * grouped by path in start-line order.
   */
  async getChunksForPaths(
    repoId: string,
    branch: string,
    paths: string[],
    source: string,
  ): Promise<Map<string, RetrievedChunk[]>> {
    const byPath = new Map<string, RetrievedChunk[]>();
    if (!paths.length) return byPath;

    const docs = await this.collection
      .find(
        { repoId, branch, path: { $in: paths } },
        { projection: CHUNK_PROJECTION },
      )
      .sort({ path: 1, startLine: 1 })
      .toArray();

    for (const doc of docs) {
      const chunk = toChunk(doc, source);
      byPath.set(chunk.path, [...(byPath.get(chunk.path) ?? []), chunk]);
    }
    return byPath;
  }

  /** Chunks whose path matches any of `patterns` (or starts with any of `prefixes`), without vectors. */
  async findByPaths(
    repoId: string,
    branch: string,
    match: { patterns?: RegExp[]; prefixes?: string[] },
    limit: number,
    source: string,
    excludePaths: string[] = [],
  ): Promise<RetrievedChunk[]> {
    const clauses = [
      ...(match.patterns ?? []).map((pattern) => ({
        path: { $regex: pattern },
      })),
      ...(match.prefixes ?? []).map((prefix) => ({
        path: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
      })),
    ];
    if (!clauses.length) return [];

    const excluded = new Set(excludePaths.map(normalizePath));
    const docs = await this.collection
      .find({ repoId, branch, $or: clauses }, { projection: CHUNK_PROJECTION })
      .limit(limit + excluded.size * 3)
      .toArray();

    return docs
      .map((doc) => toChunk(doc, source))
      .filter((chunk) => !excluded.has(normalizePath(chunk.path)))
      .slice(0, limit);
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

  async deletePath(
    repoId: string,
    branch: string,
    path: string,
  ): Promise<void> {
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
      .filter(
        (chunk) => chunk.path && !excluded.has(normalizePath(chunk.path)),
      );
  }

  async countChunks(repoId: string, branch: string): Promise<number> {
    return this.collection.countDocuments({ repoId, branch });
  }

  private createVectorStore() {
    return new MongoDBAtlasVectorSearch(
      this.embeddingsService.getQueryEmbeddingsModel(),
      {
        // @langchain/mongodb bundles its own mongodb driver typings.
        collection: this.collection as unknown as ConstructorParameters<
          typeof MongoDBAtlasVectorSearch
        >[1]['collection'],
        indexName: this.config.getOrThrow<string>('VECTOR_INDEX_NAME'),
        textKey: 'text',
        embeddingKey: 'embedding',
      },
    );
  }
}

const CHUNK_PROJECTION = { path: 1, startLine: 1, endLine: 1, text: 1 };

function toChunk(doc: Record<string, unknown>, source: string): RetrievedChunk {
  return {
    path: String(doc.path),
    startLine: Number(doc.startLine ?? 0),
    endLine: Number(doc.endLine ?? 0),
    text: typeof doc.text === 'string' ? doc.text : '',
    source,
  };
}

export function normalizePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}
