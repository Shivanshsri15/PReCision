import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { RetrieverService } from '../../../repo-rag/retrieval/retriever.service.js';
import { getGeminiApiKey } from '../gemini.factory.js';
import type { GraphState } from '../state.js';

const LOG_PREFIX = '[code-review]';

export const createRetrieverNode =
  (retrieverService: RetrieverService) =>
  async (state: GraphState, config?: LangGraphRunnableConfig): Promise<Partial<GraphState>> => {
    const input = state.cleanedInput ?? state.input;
    if (state.relatedContextFormatted !== undefined) {
      console.log(
        `${LOG_PREFIX} retriever node skipped: reusing cached context ` +
          `(${state.relatedContext?.length ?? 0} chunks)`,
      );
      return {
        relatedContext: state.relatedContext,
        relatedContextFormatted: state.relatedContextFormatted,
      };
    }

    console.log(
      `${LOG_PREFIX} retriever node: ${input.owner}/${input.repo}@${input.baseBranch} ` +
        `files=${input.files.length}`,
    );

    const { chunks, formatted } = await retrieverService.retrieveRelatedContext({
      owner: input.owner,
      repo: input.repo,
      baseBranch: input.baseBranch,
      files: input.files,
      geminiApiKey: getGeminiApiKey(config),
    });

    console.log(
      `${LOG_PREFIX} retriever node complete: ${chunks.length} chunks, ` +
        `formatted=${formatted.length} chars`,
    );

    return {
      relatedContext: chunks,
      relatedContextFormatted: formatted,
    };
  };
