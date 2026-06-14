import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const REPO_INDEX_STATUSES = [
  'pending',
  'indexing',
  'ready',
  'failed',
  'partial',
] as const;

export type RepoIndexStatus = (typeof REPO_INDEX_STATUSES)[number];

@Schema({ timestamps: true, collection: 'repo_index' })
export class RepoIndex {
  @Prop({ required: true, trim: true })
  owner!: string;

  @Prop({ required: true, trim: true })
  repo!: string;

  @Prop({ required: true, trim: true })
  branch!: string;

  @Prop({ required: true, trim: true })
  repoId!: string;

  @Prop({ required: true, enum: REPO_INDEX_STATUSES, default: 'pending' })
  status!: RepoIndexStatus;

  @Prop({ trim: true })
  indexedSha?: string;

  @Prop()
  fileCount?: number;

  @Prop()
  chunkCount?: number;

  @Prop({ required: true, trim: true })
  indexedByUserId!: string;

  @Prop()
  lastIndexedAt?: Date;

  @Prop()
  lastError?: string;

  @Prop()
  webhookId?: number;

  @Prop({ trim: true })
  webhookUrl?: string;
}

export type RepoIndexDocument = HydratedDocument<RepoIndex>;
export const RepoIndexSchema = SchemaFactory.createForClass(RepoIndex);

RepoIndexSchema.index({ owner: 1, repo: 1, branch: 1 }, { unique: true });
