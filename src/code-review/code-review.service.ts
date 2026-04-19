import { Injectable } from "@nestjs/common";
import { buildGraph } from "./langgraph/graph.js";
import { PRAnalysisPayload } from "./langgraph/state.js";

@Injectable()
export class CcodeReviewService {
  async analyzePR(payload: PRAnalysisPayload) {
    const graph = buildGraph();

    const result = await graph.invoke({
      input: payload,
    });

    return result.finalReport;
  }
}