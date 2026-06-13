import type { RetrieverService } from '../../../repo-rag/retrieval/retriever.service.js';
import type { GraphState } from '../state.js';

export const createRetrieverNode =
  (retrieverService: RetrieverService) =>
  async (state: GraphState): Promise<Partial<GraphState>> => {
    const input = state.cleanedInput ?? state.input;

    const { chunks, formatted } = await retrieverService.retrieveRelatedContext({
      owner: input.owner,
      repo: input.repo,
      baseBranch: input.baseBranch,
      files: input.files,
    });

    return {
      relatedContext: chunks,
      relatedContextFormatted: formatted,
    };
  };
