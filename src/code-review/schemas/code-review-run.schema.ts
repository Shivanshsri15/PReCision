import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { Finding, RetrievedChunk } from '../langgraph/state.js';

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

  /** Once marked complete, the next analysis of the PR starts fresh instead of re-running this one. */
  @Prop({ default: false })
  markedComplete!: boolean;

  @Prop()
  markedCompleteAt?: Date;

  /** The run this one re-ran (reusing its cached context and findings). */
  @Prop()
  rerunOf?: string;

  /** Retrieved RAG context, reused by re-runs. Excluded from queries unless selected. */
  @Prop({ type: MongooseSchema.Types.Mixed, select: false })
  contextCache?: ContextCache;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  postedComments?: PostedComment[];

  @Prop()
  reviewUrl?: string;
}

export interface ContextCache {
  chunks: RetrievedChunk[];
  formatted: string;
}

export interface PostedComment {
  /** GitHub review comment id; absent when the finding was only listed in the review body. */
  commentId?: number;
  file: string;
  line?: number;
  issue: string;
  severity: Finding['severity'];
  resolved: boolean;
  resolvedAt?: Date;
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
