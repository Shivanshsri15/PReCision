import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingsService {
  private readonly documentEmbeddings: GoogleGenerativeAIEmbeddings;
  private readonly queryEmbeddings: GoogleGenerativeAIEmbeddings;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const model = this.config.getOrThrow<string>('EMBEDDING_MODEL');

    this.documentEmbeddings = new GoogleGenerativeAIEmbeddings({
      apiKey,
      model,
    });

    this.queryEmbeddings = new GoogleGenerativeAIEmbeddings({
      apiKey,
      model,
    });
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.documentEmbeddings.embedDocuments(batch);
      results.push(...embeddings);
    }

    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.queryEmbeddings.embedQuery(text);
  }

  getQueryEmbeddingsModel(): GoogleGenerativeAIEmbeddings {
    return this.queryEmbeddings;
  }
}
