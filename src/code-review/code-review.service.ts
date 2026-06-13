import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RetrieverService } from '../repo-rag/retrieval/retriever.service.js';
import {
  CodeReviewRun,
  type CodeReviewRunDocument,
} from './schemas/code-review-run.schema.js';
import { buildGraph } from './langgraph/graph.js';
import { PRAnalysisPayload } from './langgraph/state.js';

@Injectable()
export class CcodeReviewService {
  constructor(
    private readonly retrieverService: RetrieverService,
    @InjectModel(CodeReviewRun.name)
    private readonly codeReviewRunModel: Model<CodeReviewRunDocument>,
  ) {}

  async analyzePR(userId: string, payload: PRAnalysisPayload) {
    await this.retrieverService.ensureIndexed(
      payload.owner,
      payload.repo,
      payload.baseBranch,
    );

    const run = await this.codeReviewRunModel.create({
      userId: new Types.ObjectId(userId),
      owner: payload.owner,
      repo: payload.repo,
      pullNumber: payload.prId,
      baseSha: payload.baseSha,
      headSha: payload.headSha,
      baseBranch: payload.baseBranch,
      status: 'running',
    });

    try {
      const graph = buildGraph(this.retrieverService);
      const result = await graph.invoke({ input: payload });
      const finalReport = result.finalReport ?? {
        prId: payload.prId,
        findings: [],
      };

      await this.codeReviewRunModel.findByIdAndUpdate(run._id, {
        status: 'completed',
        finalReport,
      });

      return {
        runId: String(run._id),
        ...finalReport,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed';
      await this.codeReviewRunModel.findByIdAndUpdate(run._id, {
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  async listRuns(
    userId: string,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    return this.codeReviewRunModel
      .find({
        userId: new Types.ObjectId(userId),
        owner,
        repo,
        pullNumber,
      })
      .sort({ createdAt: -1 })
      .lean();
  }
}
