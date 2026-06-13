import { GraphState } from '../state.js';

export const inputGuardNode = async (state: GraphState): Promise<GraphState> => {

  const cleanedFiles = state.input.files
    .filter(
      (file) =>
        file.patch.trim().length > 0 ||
        file.content.trim().length > 0 ||
        file.baseContent.trim().length > 0,
    )

  return {
    ...state,
    cleanedInput: {
      ...state.input,
      files: cleanedFiles,
    },
  };
};
