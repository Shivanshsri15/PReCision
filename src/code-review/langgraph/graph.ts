import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphAnnotation } from "./state.js";
import { inputGuardNode } from "./node/input-guard.node.js";
import { reviewerNode } from "./node/reviewer.node.js";
import { assemblerNode } from "./node/assembler.node.js";

export const buildGraph = () => {
  const graph = new StateGraph(GraphAnnotation)
    .addNode("inputGuard", inputGuardNode)
    .addNode("reviewer", reviewerNode)
    .addNode("assembler", assemblerNode)
    .addEdge(START, "inputGuard")
    .addEdge("inputGuard", "reviewer")
    .addEdge("reviewer", "assembler")
    .addEdge("assembler", END);

  return graph.compile();
};