import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PRFile } from '../../code-review/langgraph/state.js';
import { chunkFile } from '../chunking/chunk-file.js';
import {
  extractImportPaths,
  extractSymbols,
  resolveImportCandidates,
} from '../chunking/symbol-extractor.js';
import { shouldIndex } from '../chunking/should-index.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import {
  RepoIndex,
  type RepoIndexDocument,
} from '../schemas/repo-index.schema.js';
import type { RetrievedChunk } from '../types/chunk.types.js';
import {
  normalizePath,
  VectorStoreService,
} from '../vector-store/vector-store.service.js';
import {
  buildTestPattern,
  formatRelatedContext,
  getDirectoryPrefix,
  isTestOrSpecPath,
  mergeByFixedPriority,
} from './context-assembler.js';

export interface RetrievalInput {
  owner: string;
  repo: string;
  baseBranch: string;
  files: PRFile[];
}

@Injectable()
export class RetrieverService {
  constructor(
    @InjectModel(RepoIndex.name)
    private readonly repoIndexModel: Model<RepoIndexDocument>,
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async ensureIndexed(owner: string, repo: string, branch: string): Promise<RepoIndexDocument> {
    const record = await this.repoIndexModel.findOne({ owner, repo, branch });
    if (!record || record.status !== 'ready') {
      throw new ConflictException({
        message: 'Repository branch is not indexed for retrieval',
        indexUrl: `/api/v1/repo-index/repositories/${owner}/${repo}/branches/${branch}/index`,
        status: record?.status ?? 'missing',
      });
    }
    return record;
  }

  async retrieveRelatedContext(input: RetrievalInput): Promise<{
    chunks: RetrievedChunk[];
    formatted: string;
  }> {
    const { owner, repo, baseBranch, files } = input;
    const repoId = `${owner}/${repo}`;

    let indexRecord: RepoIndexDocument;
    try {
      indexRecord = await this.ensureIndexed(owner, repo, baseBranch);
    } catch {
      return { chunks: [], formatted: '' };
    }

    if (indexRecord.status !== 'ready') {
      return { chunks: [], formatted: '' };
    }

    const changedFiles = files.map((file) => normalizePath(file.filename));
    const changedSet = new Set(changedFiles);

    const headContent = files.map((file) => file.content).join('\n\n');
    const patchContent = files.map((file) => file.patch).join('\n\n');
    const symbols = files.flatMap((file) =>
      extractSymbols(file.filename, file.content || file.patch),
    );
    const uniqueSymbols = Array.from(new Set(symbols));

    const importGraph = await this.retrieveImportGraph(
      repoId,
      baseBranch,
      files,
      changedSet,
    );
    const pathTestResults = await this.retrievePathTests(
      repoId,
      baseBranch,
      files,
      changedSet,
    );
    const pathSiblingResults = await this.retrievePathSiblings(
      repoId,
      baseBranch,
      files,
      changedSet,
    );

    const symbolResults =
      uniqueSymbols.length > 0
        ? await this.vectorStore.query(
            await this.embeddingsService.embedQuery(uniqueSymbols.join('\n')),
            repoId,
            baseBranch,
            8,
            changedFiles,
          )
        : [];

    const semanticHead =
      headContent.trim().length > 0
        ? await this.vectorStore.query(
            await this.embeddingsService.embedQuery(headContent),
            repoId,
            baseBranch,
            8,
            changedFiles,
          )
        : [];

    const semanticPatch =
      patchContent.trim().length > 0
        ? await this.vectorStore.query(
            await this.embeddingsService.embedQuery(patchContent),
            repoId,
            baseBranch,
            8,
            changedFiles,
          )
        : [];

    symbolResults.forEach((chunk) => {
      chunk.source = 'symbol-query';
    });
    semanticHead.forEach((chunk) => {
      chunk.source = 'semantic-head';
    });
    semanticPatch.forEach((chunk) => {
      chunk.source = 'semantic-patch';
    });

    const merged = mergeByFixedPriority(
      [
        importGraph,
        pathTestResults,
        pathSiblingResults,
        symbolResults,
        semanticHead,
        semanticPatch,
      ],
      changedFiles,
    );

    return {
      chunks: merged,
      formatted: formatRelatedContext(merged),
    };
  }

  private async retrieveImportGraph(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];
    const seenPaths = new Set<string>();

    for (const file of files) {
      const source = file.content || file.patch;
      const imports = extractImportPaths(source);

      for (const importPath of imports) {
        const candidates = resolveImportCandidates(importPath, file.filename);
        for (const candidate of candidates) {
          const normalized = normalizePath(candidate);
          if (changedSet.has(normalized) || seenPaths.has(normalized)) {
            continue;
          }

          const chunks = await this.vectorStore.getChunksForPath(
            repoId,
            branch,
            normalized,
          );
          if (chunks.length > 0) {
            seenPaths.add(normalized);
            results.push(...chunks.slice(0, 3));
            break;
          }
        }
      }
    }

    return results;
  }

  private async retrievePathTests(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];

    for (const file of files) {
      const normalized = normalizePath(file.filename);
      const baseName = normalized.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
      if (!baseName) {
        continue;
      }

      const pattern = buildTestPattern(baseName);
      const chunks = await this.vectorStore.queryByPathPattern(
        repoId,
        branch,
        pattern,
        5,
        Array.from(changedSet),
      );
      results.push(...chunks.filter((chunk) => isTestOrSpecPath(chunk.path)));
    }

    return results;
  }

  private async retrievePathSiblings(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];
    const seenPrefixes = new Set<string>();

    for (const file of files) {
      const prefix = getDirectoryPrefix(file.filename);
      if (!prefix || seenPrefixes.has(prefix)) {
        continue;
      }
      seenPrefixes.add(prefix);

      const chunks = await this.vectorStore.queryByPathPrefix(
        repoId,
        branch,
        prefix,
        5,
        Array.from(changedSet),
      );

      results.push(
        ...chunks.filter(
          (chunk) => !isTestOrSpecPath(chunk.path) && !changedSet.has(normalizePath(chunk.path)),
        ),
      );
    }

    return results;
  }
}
