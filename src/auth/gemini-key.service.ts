import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TokenEncryptionService } from '../common/services/token-encryption.service.js';
import { Clients } from '../schemas/user.schema.js';

const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Resolves the Gemini API key for a user: their own saved key if present,
 * otherwise GEMINI_API_KEY from env. Decrypted keys (and "no key") are cached
 * in memory so hot paths don't hit MongoDB on every LLM/embedding call.
 */
@Injectable()
export class GeminiKeyService {
  private readonly cache = new Map<string, { key: string | null; expiresAt: number }>();

  constructor(
    @InjectModel(Clients.name) private readonly clientsModel: Model<Clients>,
    private readonly tokenEncryptionService: TokenEncryptionService,
    private readonly config: ConfigService,
  ) {}

  async save(userId: string, apiKey: string): Promise<void> {
    const key = apiKey.trim();
    await this.clientsModel.updateOne(
      { _id: userId },
      { geminiApiKey: this.tokenEncryptionService.encrypt(key) },
    );
    this.setCache(userId, key);
  }

  async remove(userId: string): Promise<void> {
    await this.clientsModel.updateOne({ _id: userId }, { $unset: { geminiApiKey: 1 } });
    this.setCache(userId, null);
  }

  async hasUserKey(userId: string): Promise<boolean> {
    return (await this.getUserKey(userId)) !== null;
  }

  hasEnvKey(): boolean {
    return Boolean(this.config.get<string>('GEMINI_API_KEY'));
  }

  async resolve(userId: string): Promise<string> {
    const key = (await this.getUserKey(userId)) ?? this.config.get<string>('GEMINI_API_KEY');
    if (!key) {
      throw new BadRequestException(
        'No Gemini API key configured. Save one with PUT /api/v1/auth/gemini-key.',
      );
    }
    return key;
  }

  private async getUserKey(userId: string): Promise<string | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.key;
    }

    const client = await this.clientsModel
      .findById(userId)
      .select('+geminiApiKey')
      .lean()
      .exec();
    const key = client?.geminiApiKey
      ? this.tokenEncryptionService.decrypt(client.geminiApiKey)
      : null;
    this.setCache(userId, key);
    return key;
  }

  private setCache(userId: string, key: string | null): void {
    this.cache.set(userId, { key, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
