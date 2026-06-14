import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type.js';
import type { GithubPushWebhookPayload } from '../../github/github.types.js';
import { GithubService } from '../../github/github.service.js';
import { chunkFile } from '../chunking/chunk-file.js';
import { shouldIndex } from '../chunking/should-index.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import {
  RepoIndex,
  type RepoIndexDocument,
} from '../schemas/repo-index.schema.js';
import { VectorStoreService } from '../vector-store/vector-store.service.js';

const LOG_PREFIX = '[repo-index]';

@Injectable()
export class IndexingService {
  constructor(
    @InjectModel(RepoIndex.name)
    private readonly repoIndexModel: Model<RepoIndexDocument>,
    private readonly githubService: GithubService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorStore: VectorStoreService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(owner: string, repo: string, branch: string) {
    const record = await this.repoIndexModel.findOne({ owner, repo, branch });
    if (!record) {
      return {
        owner,
        repo,
        branch,
        status: 'missing',
      };
    }

    return {
      owner: record.owner,
      repo: record.repo,
      branch: record.branch,
      repoId: record.repoId,
      status: record.status,
      indexedSha: record.indexedSha,
      fileCount: record.fileCount,
      chunkCount: record.chunkCount,
      lastIndexedAt: record.lastIndexedAt,
      lastError: record.lastError,
      webhookId: record.webhookId,
      webhookUrl: record.webhookUrl,
    };
  }

  async runFullIndex(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    branch: string,
  ) {
    return this.runFullIndexForUserId(user.userId, owner, repo, branch);
  }

  async runFullIndexForUserId(
    userId: string,
    owner: string,
    repo: string,
    branch: string,
  ) {
    const repoId = `${owner}/${repo}`;
    const maxFiles = this.config.get<number>('INDEX_MAX_FILES') ?? 1000;

    let record = await this.repoIndexModel.findOneAndUpdate(
      { owner, repo, branch },
      {
        owner,
        repo,
        branch,
        repoId,
        status: 'indexing',
        indexedByUserId: userId,
        lastError: undefined,
      },
      { upsert: true, new: true },
    );

    try {
      console.log(
        `${LOG_PREFIX} full index started: ${repoId}@${branch} (maxFiles=${maxFiles})`,
      );

      const headSha = await this.githubService.resolveBranchHeadForUserId(
        userId,
        owner,
        repo,
        branch,
      );
      console.log(`${LOG_PREFIX} resolved head SHA: ${headSha}`);

      const tree = await this.githubService.getTreeForUserId(
        userId,
        owner,
        repo,
        headSha,
        true,
      );
      console.log(`${LOG_PREFIX} tree entries: ${tree.length}`);

      const blobs = tree.filter(
        (entry) =>
          entry.type === 'blob' &&
          entry.path &&
          entry.sha &&
          shouldIndex(entry.path, entry.size),
      );

      const filesToIndex = blobs.slice(0, maxFiles);
      console.log(
        `${LOG_PREFIX} eligible blobs: ${blobs.length}, indexing: ${filesToIndex.length}` +
          (blobs.length > maxFiles ? ` (capped at ${maxFiles})` : ''),
      );
      if (filesToIndex.length > 0) {
        const samplePaths = filesToIndex.slice(0, 15).map((e) => e.path);
        console.log(`${LOG_PREFIX} sample paths:`, samplePaths);
      }

      let fileCount = 0;
      let chunkCount = 0;
      let skippedEmpty = 0;
      let skippedNoChunks = 0;
      let failed = 0;

      for (let i = 0; i < filesToIndex.length; i += 10) {
        const batch = filesToIndex.slice(i, i + 10);
        const batchNum = Math.floor(i / 10) + 1;
        const totalBatches = Math.ceil(filesToIndex.length / 10);
        console.log(
          `${LOG_PREFIX} batch ${batchNum}/${totalBatches}: ${batch.map((e) => e.path).join(', ')}`,
        );

        await Promise.all(
          batch.map(async (entry) => {
            const path = entry.path!;
            const blobSha = entry.sha!;
            try {
              const filePayload = (await this.githubService.getRepositoryFileForUserId(
                userId,
                owner,
                repo,
                path,
                headSha,
              )) as { content?: string };

              const content =
                typeof filePayload.content === 'string' ? filePayload.content : '';
              if (!content.trim()) {
                skippedEmpty += 1;
                console.log(`${LOG_PREFIX} skip (empty): ${path}`);
                return;
              }

              const chunks = await chunkFile(path, content);
              if (chunks.length === 0) {
                skippedNoChunks += 1;
                console.log(`${LOG_PREFIX} skip (no chunks): ${path}`);
                return;
              }

              console.log(
                `${LOG_PREFIX} embedding ${path} (${chunks.length} chunks, ${content.length} chars)`,
              );
              const embeddings = await this.embeddingsService.embedBatch(
                chunks.map((chunk) => chunk.text),
              );
              await this.vectorStore.upsertChunks(
                repoId,
                branch,
                path,
                blobSha,
                chunks,
                embeddings,
              );

              fileCount += 1;
              chunkCount += chunks.length;
              console.log(
                `${LOG_PREFIX} indexed: ${path} (${chunks.length} chunks)`,
              );
            } catch (error) {
              failed += 1;
              const message =
                error instanceof Error ? error.message : String(error);
              console.error(`${LOG_PREFIX} failed: ${path} — ${message}`);
            }
          }),
        );
      }

      const status = blobs.length > maxFiles ? 'partial' : 'ready';
      console.log(
        `${LOG_PREFIX} full index complete: ${repoId}@${branch} status=${status} ` +
          `files=${fileCount} chunks=${chunkCount} skippedEmpty=${skippedEmpty} ` +
          `skippedNoChunks=${skippedNoChunks} failed=${failed}`,
      );
      const updated = await this.repoIndexModel.findByIdAndUpdate(
        record._id,
        {
          status,
          indexedSha: headSha,
          fileCount,
          chunkCount,
          lastIndexedAt: new Date(),
        },
        { new: true },
      );

      return {
        owner,
        repo,
        branch,
        status: updated?.status,
        indexedSha: updated?.indexedSha,
        fileCount: updated?.fileCount,
        chunkCount: updated?.chunkCount,
        lastIndexedAt: updated?.lastIndexedAt,
        cappedAt: maxFiles,
        totalEligibleFiles: blobs.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Indexing failed';
      console.error(
        `${LOG_PREFIX} full index failed: ${repoId}@${branch} — ${message}`,
      );
      await this.repoIndexModel.findByIdAndUpdate(record._id, {
        status: 'failed',
        lastError: message,
      });
      throw error;
    }
  }

  async runIncrementalUpdate(
    userId: string,
    owner: string,
    repo: string,
    branch: string,
    changedPaths: string[],
    removedPaths: string[],
    headSha?: string,
  ) {
    const repoId = `${owner}/${repo}`;
    const record = await this.repoIndexModel.findOne({ owner, repo, branch });
    if (!record) {
      return { updated: false, reason: 'not-indexed' };
    }

    await this.repoIndexModel.findByIdAndUpdate(record._id, {
      status: 'indexing',
      lastError: undefined,
    });

    try {
      console.log(
        `${LOG_PREFIX} incremental update started: ${repoId}@${branch} ` +
          `changed=${changedPaths.length} removed=${removedPaths.length}`,
      );

      for (const path of removedPaths) {
        console.log(`${LOG_PREFIX} removing: ${path}`);
        await this.vectorStore.deletePath(repoId, branch, path);
      }

      const commitSha =
        headSha ??
        (await this.githubService.resolveBranchHeadForUserId(
          userId,
          owner,
          repo,
          branch,
        ));
      console.log(`${LOG_PREFIX} incremental commit SHA: ${commitSha}`);

      let fileCount = record.fileCount ?? 0;
      let chunkCount = record.chunkCount ?? 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const path of changedPaths) {
        if (!shouldIndex(path)) {
          console.log(`${LOG_PREFIX} skip (not indexable): ${path}`);
          await this.vectorStore.deletePath(repoId, branch, path);
          skipped += 1;
          continue;
        }

        try {
          const filePayload = (await this.githubService.getRepositoryFileForUserId(
            userId,
            owner,
            repo,
            path,
            commitSha,
          )) as { content?: string; sha?: string };

          const content =
            typeof filePayload.content === 'string' ? filePayload.content : '';
          const blobSha = filePayload.sha ?? commitSha;

          if (!content.trim()) {
            console.log(`${LOG_PREFIX} skip (empty, deleting vectors): ${path}`);
            await this.vectorStore.deletePath(repoId, branch, path);
            skipped += 1;
            continue;
          }

          const chunks = await chunkFile(path, content);
          console.log(
            `${LOG_PREFIX} embedding ${path} (${chunks.length} chunks)`,
          );
          const embeddings = await this.embeddingsService.embedBatch(
            chunks.map((chunk) => chunk.text),
          );
          await this.vectorStore.upsertChunks(
            repoId,
            branch,
            path,
            blobSha,
            chunks,
            embeddings,
          );

          fileCount += 1;
          chunkCount += chunks.length;
          updated += 1;
          console.log(
            `${LOG_PREFIX} updated: ${path} (${chunks.length} chunks)`,
          );
        } catch (error) {
          failed += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`${LOG_PREFIX} incremental failed: ${path} — ${message}`);
          await this.vectorStore.deletePath(repoId, branch, path);
        }
      }

      chunkCount = await this.vectorStore.countChunks(repoId, branch);
      console.log(
        `${LOG_PREFIX} incremental complete: ${repoId}@${branch} ` +
          `updated=${updated} skipped=${skipped} failed=${failed} ` +
          `fileCount=${fileCount} chunkCount=${chunkCount}`,
      );

      await this.repoIndexModel.findByIdAndUpdate(record._id, {
        status: 'ready',
        indexedSha: commitSha,
        fileCount,
        chunkCount,
        lastIndexedAt: new Date(),
      });

      return { updated: true, changedPaths: changedPaths.length, removedPaths: removedPaths.length };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Incremental update failed';
      console.error(
        `${LOG_PREFIX} incremental update failed: ${repoId}@${branch} — ${message}`,
      );
      await this.repoIndexModel.findByIdAndUpdate(record._id, {
        status: 'failed',
        lastError: message,
      });
      throw error;
    }
  }

  async registerBranchWebhook(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    branch: string,
    webhookUrl: string,
  ) {
    const repoId = `${owner}/${repo}`;

    let record = await this.repoIndexModel.findOne({ owner, repo, branch });
    if (!record) {
      record = await this.repoIndexModel.create({
        owner,
        repo,
        branch,
        repoId,
        status: 'pending',
        indexedByUserId: user.userId,
      });
    } else if (record.indexedByUserId !== user.userId) {
      record.indexedByUserId = user.userId;
      await record.save();
    }

    const { hook, webhookUrl: normalizedUrl, created } =
      await this.githubService.ensurePushWebhook(
        user,
        owner,
        repo,
        webhookUrl,
        record.webhookId,
      );

    record.webhookId = hook.id;
    record.webhookUrl = normalizedUrl;
    await record.save();

    return {
      owner,
      repo,
      branch,
      webhookId: hook.id,
      webhookUrl: normalizedUrl,
      created,
      events: hook.events,
      active: hook.active,
      message: created
        ? undefined
        : 'Webhook already registered for this URL',
    };
  }

  async handlePushWebhook(payload: GithubPushWebhookPayload) {
    const ref = payload.ref;
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;

    if (!ref || !owner || !repo) {
      return { handled: false, reason: 'invalid-payload' };
    }

    const branch = ref.replace('refs/heads/', '');
    const record = await this.repoIndexModel.findOne({ owner, repo, branch });

    if (!record) {
      // Branch isn't indexed yet. Auto-enroll it, but only if it's an allowed
      // review branch AND the repo was already connected by some user — the
      // webhook itself carries no identity, so we reuse that user's token.
      if (!this.isAllowedReviewBranch(branch)) {
        console.log(
          `${LOG_PREFIX} webhook push ignored (branch not in allowlist): ${owner}/${repo}@${branch}`,
        );
        return { handled: false, reason: 'branch-not-allowed' };
      }

      const repoRecord = await this.repoIndexModel.findOne({ owner, repo });
      if (!repoRecord) {
        console.log(
          `${LOG_PREFIX} webhook push ignored (repo not connected): ${owner}/${repo}@${branch}`,
        );
        return { handled: false, reason: 'repo-not-connected' };
      }

      console.log(
        `${LOG_PREFIX} webhook push: auto-indexing new branch ${owner}/${repo}@${branch}`,
      );
      // A full index can't be built from a push payload (it lists only changed
      // files) and is slow — fire-and-forget so the webhook returns 200 fast.
      void this.runFullIndexForUserId(
        repoRecord.indexedByUserId,
        owner,
        repo,
        branch,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `${LOG_PREFIX} auto-index failed: ${owner}/${repo}@${branch} — ${message}`,
        );
      });

      return { handled: true, action: 'full-index-started', branch };
    }

    const { changed, removed } =
      this.githubService.extractChangedPathsFromPushPayload(payload);

    console.log(
      `${LOG_PREFIX} webhook push: ${owner}/${repo}@${branch} ` +
        `after=${payload.after} changed=${changed.length} removed=${removed.length}`,
    );

    await this.runIncrementalUpdate(
      record.indexedByUserId,
      owner,
      repo,
      branch,
      changed,
      removed,
      payload.after,
    );

    return {
      handled: true,
      changed: changed.length,
      removed: removed.length,
    };
  }

  private isAllowedReviewBranch(branch: string): boolean {
    const configured =
      this.config.get<string>('ALLOWED_REVIEW_BRANCHES') ?? 'main,master';
    const allowed = configured
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    return allowed.includes(branch);
  }
}
