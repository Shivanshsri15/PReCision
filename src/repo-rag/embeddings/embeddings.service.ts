import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
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

@Injectable()
export class EmbeddingsService {
  private readonly model: string;
  private readonly outputDimensionality: number;
  private readonly documentModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private readonly queryModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private embedChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    this.model = this.config.getOrThrow<string>('EMBEDDING_MODEL');
    this.outputDimensionality = this.config.get<number>('EMBEDDING_DIMS') ?? 768;

    const client = new GoogleGenerativeAI(apiKey);
    this.documentModel = client.getGenerativeModel({ model: this.model });
    this.queryModel = client.getGenerativeModel({ model: this.model });
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    return this.runSerialized(async () => {
      const results: number[][] = [];

      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        if (i > 0) {
          await sleep(BATCH_DELAY_MS);
        }

        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const response = await this.withRetry(() =>
          this.documentModel.batchEmbedContents({
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

  async embedQuery(text: string): Promise<number[]> {
    return this.runSerialized(async () => {
      const response = await this.withRetry(() =>
        this.queryModel.embedContent({
          content: {
            role: 'user',
            parts: [{ text }],
          },
          taskType: TaskType.RETRIEVAL_QUERY,
          outputDimensionality: this.outputDimensionality,
        } as any),
      );

      return response.embedding.values ?? [];
    });
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
