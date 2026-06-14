import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const CODE_REVIEW_RUN_STATUSES = [
  'running',
  'completed',
  'failed',
] as const;

export type CodeReviewRunStatus = (typeof CODE_REVIEW_RUN_STATUSES)[number];

@Schema({ timestamps: true, collection: 'CodeReviewRuns' })
export class CodeReviewRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  owner!: string;

  @Prop({ required: true, trim: true, index: true })
  repo!: string;

  @Prop({ required: true, index: true })
  pullNumber!: number;

  @Prop({ required: true, trim: true })
  baseSha!: string;

  @Prop({ required: true, trim: true })
  headSha!: string;

  @Prop({ required: true, trim: true })
  baseBranch!: string;

  @Prop({ required: true, enum: CODE_REVIEW_RUN_STATUSES, default: 'running' })
  status!: CodeReviewRunStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  finalReport?: Record<string, unknown>;

  @Prop()
  error?: string;
}

export type CodeReviewRunDocument = HydratedDocument<CodeReviewRun>;
export const CodeReviewRunSchema = SchemaFactory.createForClass(CodeReviewRun);

CodeReviewRunSchema.index({
  userId: 1,
  owner: 1,
  repo: 1,
  pullNumber: 1,
  createdAt: -1,
});
