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

const LOG_PREFIX = '[code-review]';

@Injectable()
export class CcodeReviewService {
  constructor(
    private readonly retrieverService: RetrieverService,
    @InjectModel(CodeReviewRun.name)
    private readonly codeReviewRunModel: Model<CodeReviewRunDocument>,
  ) {}

  async analyzePR(userId: string, payload: PRAnalysisPayload) {
    const repoId = `${payload.owner}/${payload.repo}`;
    console.log(
      `${LOG_PREFIX} analyze started: ${repoId} PR #${payload.prId} ` +
        `base=${payload.baseBranch}@${payload.baseSha.slice(0, 7)} ` +
        `head=${payload.headSha.slice(0, 7)} files=${payload.files.length}`,
    );

    await this.retrieverService.ensureIndexed(
      payload.owner,
      payload.repo,
      payload.baseBranch,
    );
    console.log(`${LOG_PREFIX} index verified for ${repoId}@${payload.baseBranch}`);

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
      console.log(
        `${LOG_PREFIX} graph invoke started: runId=${run._id} ` +
          `pipeline=inputGuard→retriever→[quality|security|performance]→join→bugDetection→assembler`,
      );
      const graph = buildGraph(this.retrieverService);
      const result = await graph.invoke({ input: payload });
      const finalReport = result.finalReport ?? {
        prId: payload.prId,
        overallSummary: 'Review completed.',
        findings: [],
        allFindings: [],
        domainReports: {},
      };

      const allFindingsCount = Array.isArray(finalReport.allFindings)
        ? finalReport.allFindings.length
        : Array.isArray(finalReport.findings)
          ? finalReport.findings.length
          : 0;
      const relatedContextCount =
        typeof finalReport.relatedContextCount === 'number'
          ? finalReport.relatedContextCount
          : (result.relatedContext?.length ?? 0);
      console.log(
        `${LOG_PREFIX} graph complete: runId=${run._id} ` +
          `findings=${allFindingsCount} relatedContext=${relatedContextCount}`,
      );

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
      console.error(
        `${LOG_PREFIX} analyze failed: ${repoId} PR #${payload.prId} runId=${run._id} — ${message}`,
      );
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
