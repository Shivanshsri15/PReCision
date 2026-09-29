import {
  type BatchEmbedContentsRequest,
  GoogleGenerativeAI,
  TaskType,
} from '@google/generative-ai';
import { Embeddings } from '@langchain/core/embeddings';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LOG_PREFIX = '[embeddings]';
const EMBED_BATCH_SIZE = 20;
const BATCH_DELAY_MS = 400;
const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EmbeddingModel = ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

@Injectable()
export class EmbeddingsService {
  private readonly model: string;
  private readonly outputDimensionality: number;
  private readonly modelsByKey = new Map<string, EmbeddingModel>();
  private embedChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {
    this.model = this.config.getOrThrow<string>('EMBEDDING_MODEL');
    this.outputDimensionality =
      this.config.get<number>('EMBEDDING_DIMS') ?? 768;
  }

  /** `apiKey` is the caller's resolved Gemini key; falls back to GEMINI_API_KEY. */
  async embedBatch(texts: string[], apiKey?: string): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const model = this.getModel(apiKey);
    return this.runSerialized(async () => {
      const results: number[][] = [];

      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        if (i > 0) {
          await sleep(BATCH_DELAY_MS);
        }

        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const response = await this.withRetry(() =>
          model.batchEmbedContents({
            requests: batch.map((text) => ({
              content: {
                role: 'user',
                parts: [{ text }],
              },
              taskType: TaskType.RETRIEVAL_DOCUMENT,
              outputDimensionality: this.outputDimensionality,
            })) as any,
          }),
        );

        for (const embedding of response.embeddings) {
          results.push(embedding.values ?? []);
        }
      }

      return results;
    });
  }

  /**
   * A single small request, so it is not queued behind document batches:
   * otherwise a review would wait for any in-progress indexing to finish.
   */
  async embedQuery(text: string, apiKey?: string): Promise<number[]> {
    const model = this.getModel(apiKey);
    const response = await this.withRetry(() =>
      model.embedContent({
        content: {
          role: 'user',
          parts: [{ text }],
        },
        taskType: TaskType.RETRIEVAL_QUERY,
        outputDimensionality: this.outputDimensionality,
      } as any),
    );

    return response.embedding.values ?? [];
  }

  /** Many short queries in one request; not queued behind document batches. */
  async embedQueries(texts: string[], apiKey?: string): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const model = this.getModel(apiKey);
    const response = await this.withRetry(() =>
      model.batchEmbedContents({
        requests: texts.map((text) => ({
          content: { role: 'user', parts: [{ text }] },
          taskType: TaskType.RETRIEVAL_QUERY,
          // Supported by the API but missing from the SDK's request type.
          outputDimensionality: this.outputDimensionality,
        })) as unknown as BatchEmbedContentsRequest['requests'],
      }),
    );

    return response.embeddings.map((embedding) => embedding.values ?? []);
  }

  getQueryEmbeddingsModel(): Embeddings {
    const service = this;
    return new (class extends Embeddings {
      embedQuery(document: string) {
        return service.embedQuery(document);
      }

      embedDocuments(documents: string[]) {
        return service.embedBatch(documents);
      }
    })({});
  }

  private getModel(apiKey?: string): EmbeddingModel {
    const key = apiKey ?? this.config.get<string>('GEMINI_API_KEY');
    if (!key) {
      throw new Error('No Gemini API key available for embeddings');
    }

    let model = this.modelsByKey.get(key);
    if (!model) {
      model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: this.model,
      });
      this.modelsByKey.set(key, model);
    }
    return model;
  }

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.embedChain.then(fn, fn);
    this.embedChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'status' in error) {
      return (error as { status?: number }).status === 429;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('429') || message.includes('Too Many Requests');
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isRateLimitError(error) || attempt === MAX_RETRIES) {
          throw error;
        }

        const delayMs = Math.min(1000 * 2 ** attempt, 15000);
        console.warn(
          `${LOG_PREFIX} rate limited, retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }

    throw lastError;
  }
}
