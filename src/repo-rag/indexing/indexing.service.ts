import {
  ConflictException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GeminiKeyService } from '../../auth/gemini-key.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type.js';
import { EventsService } from '../../events/events.service.js';
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
/** Recent files kept per job so a reconnecting client can rebuild the live list. */
const MAX_TRACKED_FILES = 300;

export type IndexedFileStatus = 'indexed' | 'skipped' | 'failed' | 'removed';

export interface IndexedFile {
  path: string;
  status: IndexedFileStatus;
  chunks?: number;
}

interface IndexProgress {
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  kind: 'full' | 'incremental';
  total: number;
  processed: number;
  startedAt: string;
  files: IndexedFile[];
}

@Injectable()
export class IndexingService implements OnModuleInit {
  private readonly progress = new Map<string, IndexProgress>();

  constructor(
    @InjectModel(RepoIndex.name)
    private readonly repoIndexModel: Model<RepoIndexDocument>,
    private readonly githubService: GithubService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorStore: VectorStoreService,
    private readonly config: ConfigService,
    private readonly geminiKeyService: GeminiKeyService,
    private readonly events: EventsService,
  ) {}

  /** Indexing runs in-process, so any record still `indexing` at boot was cut off by a restart. */
  async onModuleInit() {
    this.events.registerSnapshot('indexing', (userId) =>
      [...this.progress.values()]
        .filter((job) => job.userId === userId)
        .map((job) => ({ ...this.summary(job), files: job.files })),
    );

    const { modifiedCount } = await this.repoIndexModel.updateMany(
      { status: 'indexing' },
      {
        status: 'failed',
        lastError:
          'Interrupted: the server restarted while indexing. Re-index to continue.',
      },
    );
    if (modifiedCount) {
      console.log(
        `${LOG_PREFIX} marked ${modifiedCount} interrupted index job(s) as failed`,
      );
    }
  }

  async listForUser(userId: string) {
    return this.repoIndexModel
      .find({ indexedByUserId: userId })
      .select('-__v')
      .sort({ updatedAt: -1 })
      .lean();
  }

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

  /**
   * Starts a full index in the background and returns immediately. Progress
   * is published on the user's event stream (`index.*` events).
   */
  async startFullIndex(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    branch: string,
  ) {
    const active = this.progress.get(this.key(owner, repo, branch));
    const other = [...this.progress.values()].find(
      (job) =>
        job !== active && job.userId === user.userId && job.kind === 'full',
    );
    if (other) {
      throw new ConflictException(
        `${other.owner}/${other.repo}@${other.branch} is still being indexed. Wait for it to finish before indexing another repository.`,
      );
    }
    if (active) {
      return {
        owner,
        repo,
        branch,
        status: 'indexing',
        alreadyRunning: true,
        startedAt: active.startedAt,
      };
    }

    const progress = this.beginProgress(
      user.userId,
      owner,
      repo,
      branch,
      'full',
    )!;
    let record: RepoIndexDocument;
    try {
      record = await this.repoIndexModel.findOneAndUpdate(
        { owner, repo, branch },
        {
          owner,
          repo,
          branch,
          repoId: `${owner}/${repo}`,
          status: 'indexing',
          indexedByUserId: user.userId,
          lastError: undefined,
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      this.failProgress(progress, error);
      throw error;
    }

    void this.runFullIndex(user.userId, record, progress).catch(
      () => undefined,
    );
    return {
      owner,
      repo,
      branch,
      status: 'indexing',
      alreadyRunning: false,
      startedAt: progress.startedAt,
    };
  }

  private async runFullIndex(
    userId: string,
    record: RepoIndexDocument,
    progress: IndexProgress,
  ) {
    const { owner, repo, branch } = record;
    const repoId = `${owner}/${repo}`;
    const maxFiles = this.config.get<number>('INDEX_MAX_FILES') ?? 1000;

    try {
      const geminiApiKey = await this.geminiKeyService.resolve(userId);
      await this.ensureBranchWebhook(userId, record);

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
      this.setTotal(progress, filesToIndex.length);

      let fileCount = 0;
      let chunkCount = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < filesToIndex.length; i += 10) {
        const batch = filesToIndex.slice(i, i + 10);

        await Promise.all(
          batch.map(async (entry) => {
            const path = entry.path!;
            const blobSha = entry.sha!;
            try {
              const filePayload =
                (await this.githubService.getRepositoryFileForUserId(
                  userId,
                  owner,
                  repo,
                  path,
                  headSha,
                )) as { content?: string };

              const content =
                typeof filePayload.content === 'string'
                  ? filePayload.content
                  : '';
              const chunks = content.trim()
                ? await chunkFile(path, content)
                : [];
              if (chunks.length === 0) {
                skipped += 1;
                this.recordFile(progress, { path, status: 'skipped' });
                return;
              }

              const embeddings = await this.embeddingsService.embedBatch(
                chunks.map((chunk) => chunk.text),
                geminiApiKey,
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
              this.recordFile(progress, {
                path,
                status: 'indexed',
                chunks: chunks.length,
              });
            } catch (error) {
              failed += 1;
              const message =
                error instanceof Error ? error.message : String(error);
              console.error(`${LOG_PREFIX} failed: ${path} — ${message}`);
              this.recordFile(progress, { path, status: 'failed' });
            }
          }),
        );
      }

      const status = blobs.length > maxFiles ? 'partial' : 'ready';
      console.log(
        `${LOG_PREFIX} full index complete: ${repoId}@${branch} status=${status} ` +
          `files=${fileCount} chunks=${chunkCount} skipped=${skipped} failed=${failed}`,
      );
      await this.repoIndexModel.findByIdAndUpdate(record._id, {
        status,
        indexedSha: headSha,
        fileCount,
        chunkCount,
        lastIndexedAt: new Date(),
      });
      this.completeProgress(progress, {
        status,
        fileCount,
        chunkCount,
        skipped,
        failed,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Indexing failed';
      console.error(
        `${LOG_PREFIX} full index failed: ${repoId}@${branch} — ${message}`,
      );
      await this.repoIndexModel.findByIdAndUpdate(record._id, {
        status: 'failed',
        lastError: message,
      });
      this.failProgress(progress, error);
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

    const progress = this.beginProgress(
      userId,
      owner,
      repo,
      branch,
      'incremental',
    );
    this.setTotal(progress, changedPaths.length + removedPaths.length);
    await this.repoIndexModel.findByIdAndUpdate(record._id, {
      status: 'indexing',
      lastError: undefined,
    });

    try {
      const geminiApiKey = await this.geminiKeyService.resolve(userId);
      console.log(
        `${LOG_PREFIX} incremental update started: ${repoId}@${branch} ` +
          `changed=${changedPaths.length} removed=${removedPaths.length}`,
      );

      for (const path of removedPaths) {
        await this.vectorStore.deletePath(repoId, branch, path);
        this.recordFile(progress, { path, status: 'removed' });
      }

      const commitSha =
        headSha ??
        (await this.githubService.resolveBranchHeadForUserId(
          userId,
          owner,
          repo,
          branch,
        ));

      let fileCount = record.fileCount ?? 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const path of changedPaths) {
        if (!shouldIndex(path)) {
          await this.vectorStore.deletePath(repoId, branch, path);
          skipped += 1;
          this.recordFile(progress, { path, status: 'skipped' });
          continue;
        }

        try {
          const filePayload =
            (await this.githubService.getRepositoryFileForUserId(
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
            await this.vectorStore.deletePath(repoId, branch, path);
            skipped += 1;
            this.recordFile(progress, { path, status: 'skipped' });
            continue;
          }

          const chunks = await chunkFile(path, content);
          const embeddings = await this.embeddingsService.embedBatch(
            chunks.map((chunk) => chunk.text),
            geminiApiKey,
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
          updated += 1;
          this.recordFile(progress, {
            path,
            status: 'indexed',
            chunks: chunks.length,
          });
        } catch (error) {
          failed += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `${LOG_PREFIX} incremental failed: ${path} — ${message}`,
          );
          await this.vectorStore.deletePath(repoId, branch, path);
          this.recordFile(progress, { path, status: 'failed' });
        }
      }

      const chunkCount = await this.vectorStore.countChunks(repoId, branch);
      console.log(
        `${LOG_PREFIX} incremental complete: ${repoId}@${branch} ` +
          `updated=${updated} skipped=${skipped} failed=${failed} chunkCount=${chunkCount}`,
      );

      await this.repoIndexModel.findByIdAndUpdate(record._id, {
        status: 'ready',
        indexedSha: commitSha,
        fileCount,
        chunkCount,
        lastIndexedAt: new Date(),
      });
      this.completeProgress(progress, {
        status: 'ready',
        fileCount,
        chunkCount,
        skipped,
        failed,
      });

      return {
        updated: true,
        changedPaths: changedPaths.length,
        removedPaths: removedPaths.length,
      };
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
      this.failProgress(progress, error);
      throw error;
    }
  }

  /**
   * Registers (or reuses) the repo push webhook before a branch is indexed so
   * no pushes are missed while indexing runs. GitHub webhooks are repo-level;
   * pushes to branches without an index record are ignored in handlePushWebhook.
   */
  private async ensureBranchWebhook(
    userId: string,
    record: RepoIndexDocument,
  ): Promise<void> {
    const webhookUrl = this.config.get<string>('GITHUB_WEBHOOK_URL');
    if (!webhookUrl) {
      console.warn(
        `${LOG_PREFIX} GITHUB_WEBHOOK_URL not set; skipping webhook for ${record.repoId}@${record.branch}`,
      );
      return;
    }

    const {
      hook,
      webhookUrl: normalizedUrl,
      created,
    } = await this.githubService.ensurePushWebhook(
      userId,
      record.owner,
      record.repo,
      webhookUrl,
      record.webhookId,
    );
    console.log(
      `${LOG_PREFIX} webhook ${created ? 'created' : 'reused'}: ${record.repoId}@${record.branch} ` +
        `id=${hook.id} url=${normalizedUrl}`,
    );

    await this.repoIndexModel.findByIdAndUpdate(record._id, {
      webhookId: hook.id,
      webhookUrl: normalizedUrl,
    });
  }

  /** Notifies the indexing user of the push and syncs the index in the background. */
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
      console.log(
        `${LOG_PREFIX} webhook push ignored (branch not indexed): ${owner}/${repo}@${branch}`,
      );
      return { handled: false, reason: 'branch-not-indexed' };
    }

    const { changed, removed } =
      this.githubService.extractChangedPathsFromPushPayload(payload);

    console.log(
      `${LOG_PREFIX} webhook push: ${owner}/${repo}@${branch} ` +
        `after=${payload.after} changed=${changed.length} removed=${removed.length}`,
    );

    this.events.emit(record.indexedByUserId, 'push.received', {
      owner,
      repo,
      branch,
      sha: payload.after,
      message: payload.head_commit?.message?.split('\n')[0],
      pusher: payload.pusher?.name,
      compareUrl: payload.compare,
      changed: changed.length,
      removed: removed.length,
    });

    void this.runIncrementalUpdate(
      record.indexedByUserId,
      owner,
      repo,
      branch,
      changed,
      removed,
      payload.after,
    ).catch(() => undefined);

    return {
      handled: true,
      changed: changed.length,
      removed: removed.length,
    };
  }

  private key(owner: string, repo: string, branch: string) {
    return `${owner}/${repo}@${branch}`;
  }

  private summary(job: IndexProgress) {
    return {
      owner: job.owner,
      repo: job.repo,
      branch: job.branch,
      kind: job.kind,
      total: job.total,
      processed: job.processed,
      startedAt: job.startedAt,
    };
  }

  /** Returns null when another job already reports progress for this branch. */
  private beginProgress(
    userId: string,
    owner: string,
    repo: string,
    branch: string,
    kind: IndexProgress['kind'],
  ): IndexProgress | null {
    const key = this.key(owner, repo, branch);
    if (this.progress.has(key)) return null;
    const job: IndexProgress = {
      userId,
      owner,
      repo,
      branch,
      kind,
      total: 0,
      processed: 0,
      startedAt: new Date().toISOString(),
      files: [],
    };
    this.progress.set(key, job);
    this.events.emit(userId, 'index.started', this.summary(job));
    return job;
  }

  private setTotal(job: IndexProgress | null, total: number) {
    if (!job) return;
    job.total = total;
    this.events.emit(job.userId, 'index.progress', this.summary(job));
  }

  private recordFile(job: IndexProgress | null, file: IndexedFile) {
    if (!job) return;
    job.processed += 1;
    job.files.push(file);
    if (job.files.length > MAX_TRACKED_FILES) job.files.shift();
    this.events.emit(job.userId, 'index.file', { ...this.summary(job), file });
  }

  private completeProgress(
    job: IndexProgress | null,
    result: {
      status: string;
      fileCount: number;
      chunkCount: number;
      skipped: number;
      failed: number;
    },
  ) {
    if (!job) return;
    this.progress.delete(this.key(job.owner, job.repo, job.branch));
    this.events.emit(job.userId, 'index.completed', {
      ...this.summary(job),
      ...result,
    });
  }

  private failProgress(job: IndexProgress | null, error: unknown) {
    if (!job) return;
    this.progress.delete(this.key(job.owner, job.repo, job.branch));
    this.events.emit(job.userId, 'index.failed', {
      ...this.summary(job),
      error: error instanceof Error ? error.message : 'Indexing failed',
    });
  }
}
