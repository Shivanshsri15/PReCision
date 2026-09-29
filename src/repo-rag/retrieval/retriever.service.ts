import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PRFile } from '../../code-review/langgraph/state.js';
import {
  extractImportPaths,
  resolveImportCandidates,
} from '../chunking/symbol-extractor.js';
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

const LOG_PREFIX = '[code-review]';
const SEMANTIC_TIMEOUT_MS = 8000;
const SEMANTIC_MAX_FILES = 20;
const SEMANTIC_QUERY_CHARS = 600;
const SEMANTIC_RESULTS_PER_FILE = 4;

export interface RetrievalInput {
  owner: string;
  repo: string;
  baseBranch: string;
  files: PRFile[];
  geminiApiKey?: string;
}

@Injectable()
export class RetrieverService {
  constructor(
    @InjectModel(RepoIndex.name)
    private readonly repoIndexModel: Model<RepoIndexDocument>,
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async ensureIndexed(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<RepoIndexDocument> {
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
    const { owner, repo, baseBranch, files, geminiApiKey } = input;
    const repoId = `${owner}/${repo}`;
    console.log(
      `${LOG_PREFIX} retrieval started: ${repoId}@${baseBranch} files=${files.length}`,
    );

    let indexRecord: RepoIndexDocument;
    try {
      indexRecord = await this.ensureIndexed(owner, repo, baseBranch);
    } catch {
      console.log(
        `${LOG_PREFIX} retrieval skipped: ${repoId}@${baseBranch} not indexed`,
      );
      return { chunks: [], formatted: '' };
    }

    if (indexRecord.status !== 'ready') {
      console.log(
        `${LOG_PREFIX} retrieval skipped: ${repoId}@${baseBranch} status=${indexRecord.status}`,
      );
      return { chunks: [], formatted: '' };
    }

    const changedFiles = files.map((file) => normalizePath(file.filename));
    const changedSet = new Set(changedFiles);
    const startedAt = Date.now();

    // Every source is one database round trip, all in parallel. The merged
    // context is capped at a few thousand chars, so anything slow is skipped.
    const [importGraph, pathTestResults, pathSiblingResults, semanticResults] =
      await Promise.all([
        this.retrieveImportGraph(repoId, baseBranch, files, changedSet),
        this.retrievePathTests(repoId, baseBranch, files, changedFiles),
        this.retrievePathSiblings(repoId, baseBranch, files, changedFiles),
        this.retrieveSemantic(
          repoId,
          baseBranch,
          files,
          changedFiles,
          geminiApiKey,
        ),
      ]);

    const merged = mergeByFixedPriority(
      [importGraph, pathTestResults, semanticResults, pathSiblingResults],
      changedFiles,
    );

    console.log(
      `${LOG_PREFIX} retrieval sources: import=${importGraph.length} tests=${pathTestResults.length} ` +
        `siblings=${pathSiblingResults.length} semantic=${semanticResults.length} → merged=${merged.length} ` +
        `in ${Date.now() - startedAt}ms`,
    );
    if (merged.length > 0) {
      console.log(
        `${LOG_PREFIX} retrieval top paths:`,
        merged.slice(0, 8).map((c) => `${c.path} (${c.source ?? 'unknown'})`),
      );
    }

    return {
      chunks: merged,
      formatted: formatRelatedContext(merged),
    };
  }

  /** Resolves every import of the changed files, then loads all candidate paths in one query. */
  private async retrieveImportGraph(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const candidateGroups: string[][] = [];
    for (const file of files) {
      for (const importPath of extractImportPaths(file.content || file.patch)) {
        const candidates = resolveImportCandidates(importPath, file.filename)
          .map(normalizePath)
          .filter((candidate) => !changedSet.has(candidate));
        if (candidates.length) candidateGroups.push(candidates);
      }
    }
    if (!candidateGroups.length) return [];

    try {
      const byPath = await this.vectorStore.getChunksForPaths(
        repoId,
        branch,
        [...new Set(candidateGroups.flat())],
        'import-graph',
      );
      const results: RetrievedChunk[] = [];
      const seenPaths = new Set<string>();
      for (const candidates of candidateGroups) {
        const hit = candidates.find((candidate) => byPath.has(candidate));
        if (!hit || seenPaths.has(hit)) continue;
        seenPaths.add(hit);
        results.push(...byPath.get(hit)!.slice(0, 3));
      }
      return results;
    } catch (error) {
      this.warnSkipped('import graph', error);
      return [];
    }
  }

  private async retrievePathTests(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedFiles: string[],
  ): Promise<RetrievedChunk[]> {
    const patterns = [
      ...new Set(
        files
          .map(
            (file) =>
              normalizePath(file.filename)
                .split('/')
                .pop()
                ?.replace(/\.[^.]+$/, '') ?? '',
          )
          .filter(Boolean),
      ),
    ].map(buildTestPattern);
    if (!patterns.length) return [];

    try {
      const chunks = await this.vectorStore.findByPaths(
        repoId,
        branch,
        { patterns },
        10,
        'path-pattern',
        changedFiles,
      );
      return chunks.filter((chunk) => isTestOrSpecPath(chunk.path));
    } catch (error) {
      this.warnSkipped('related tests', error);
      return [];
    }
  }

  private async retrievePathSiblings(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedFiles: string[],
  ): Promise<RetrievedChunk[]> {
    const prefixes = [
      ...new Set(
        files.map((file) => getDirectoryPrefix(file.filename)).filter(Boolean),
      ),
    ];
    if (!prefixes.length) return [];

    try {
      const chunks = await this.vectorStore.findByPaths(
        repoId,
        branch,
        { prefixes },
        10,
        'path-prefix',
        changedFiles,
      );
      return chunks.filter((chunk) => !isTestOrSpecPath(chunk.path));
    } catch (error) {
      this.warnSkipped('sibling files', error);
      return [];
    }
  }

  /**
   * One embedding per changed file (single batch call), one vector search per
   * file, results interleaved by rank so every file contributes its best match
   * first. Bounded so a slow embedding never stalls the review.
   */
  private async retrieveSemantic(
    repoId: string,
    branch: string,
    files: PRFile[],
    changedFiles: string[],
    geminiApiKey?: string,
  ): Promise<RetrievedChunk[]> {
    const queries = files
      .map(buildFileQuery)
      .filter((query): query is string => Boolean(query))
      .slice(0, SEMANTIC_MAX_FILES);
    if (!queries.length) return [];

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${SEMANTIC_TIMEOUT_MS}ms`)),
        SEMANTIC_TIMEOUT_MS,
      );
    });

    try {
      const search = (async () => {
        const embeddings = await this.embeddingsService.embedQueries(
          queries,
          geminiApiKey,
        );
        return Promise.all(
          embeddings.map((embedding) =>
            this.vectorStore.query(
              embedding,
              repoId,
              branch,
              SEMANTIC_RESULTS_PER_FILE,
              changedFiles,
            ),
          ),
        );
      })();
      const perFile = await Promise.race([search, timeout]);
      console.log(
        `${LOG_PREFIX} semantic search: queries=${queries.length} hits=${perFile.flat().length}`,
      );
      return interleaveUnique(perFile).map((chunk) => ({
        ...chunk,
        source: 'semantic-query',
      }));
    } catch (error) {
      this.warnSkipped('semantic vector search', error);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private warnSkipped(source: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${LOG_PREFIX} ${source} skipped — ${message}`);
  }
}

/** `File: <path>` followed by the patch's added lines, without diff markers. */
function buildFileQuery(file: PRFile): string | null {
  const added = (file.patch ?? '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, SEMANTIC_QUERY_CHARS);
  return added ? `File: ${normalizePath(file.filename)}\n${added}` : null;
}

/** Rank 1 of every list, then rank 2, …; drops chunks already taken. */
function interleaveUnique(lists: RetrievedChunk[][]): RetrievedChunk[] {
  const seen = new Set<string>();
  const merged: RetrievedChunk[] = [];
  const depth = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < depth; rank++) {
    for (const list of lists) {
      const chunk = list[rank];
      if (!chunk) continue;
      const key = `${normalizePath(chunk.path)}:${chunk.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(chunk);
    }
  }
  return merged;
}
