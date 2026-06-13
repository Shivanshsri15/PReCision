import { END, START, StateGraph } from '@langchain/langgraph';
import type { RetrieverService } from '../../repo-rag/retrieval/retriever.service.js';
import { GraphAnnotation } from './state.js';
import { assemblerNode } from './node/assembler.node.js';
import { inputGuardNode } from './node/input-guard.node.js';
import { createRetrieverNode } from './node/retriever.node.js';
import { reviewerNode } from './node/reviewer.node.js';

export const buildGraph = (retrieverService: RetrieverService) => {
  const graph = new StateGraph(GraphAnnotation)
    .addNode('inputGuard', inputGuardNode)
    .addNode('retriever', createRetrieverNode(retrieverService))
    .addNode('reviewer', reviewerNode)
    .addNode('assembler', assemblerNode)
    .addEdge(START, 'inputGuard')
    .addEdge('inputGuard', 'retriever')
    .addEdge('retriever', 'reviewer')
    .addEdge('reviewer', 'assembler')
    .addEdge('assembler', END);

  return graph.compile();
};
