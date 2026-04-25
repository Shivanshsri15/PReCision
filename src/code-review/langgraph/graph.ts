import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphAnnotation } from "./state.js";
import { inputGuardNode } from "./node/input-guard.node.js";
import { reviewerNode } from "./node/reviewer.node.js";
import { assemblerNode } from "./node/assembler.node.js";
import { qualityReviewerNode } from "./node/quality-reviewer.node.js";
import { securityReviewerNode } from "./node/security-reviewer.node.js";
import { performanceReviewerNode } from "./node/performance-reviewer.node.js";
import { joinNode } from "./node/join.node.js";

export const buildGraph = () => {
  const graph = new StateGraph(GraphAnnotation)
    .addNode("inputGuard", inputGuardNode)
    .addNode("qualityReview", qualityReviewerNode)
    .addNode("securityReview", securityReviewerNode)
    .addNode("performanceReview", performanceReviewerNode)
    .addNode("joinNode", joinNode)
    .addNode("reviewer", reviewerNode)
    .addNode("assembler", assemblerNode)
    .addEdge(START, "inputGuard")
    // Fan-out: run domain nodes in parallel
    .addEdge("inputGuard", "qualityReview")
    .addEdge("inputGuard", "securityReview")
    .addEdge("inputGuard", "performanceReview")
    // Join barrier (may execute multiple times; downstream nodes are guarded)
    .addEdge("qualityReview", "joinNode")
    .addEdge("securityReview", "joinNode")
    .addEdge("performanceReview", "joinNode")
    .addEdge("joinNode", "reviewer")
    .addEdge("reviewer", "assembler")
    .addEdge("assembler", END);

  return graph.compile();
};