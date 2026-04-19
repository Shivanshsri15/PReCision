import { GraphState } from "../state.js";

export const inputGuardNode = async (state: GraphState): Promise<GraphState> => {
  const maxFiles = 5;

  const cleanedFiles = state.input.files
    .filter((f) => f.patch || f.content)
    .slice(0, maxFiles);

  return {
    ...state,
    cleanedInput: {
      ...state.input,
      files: cleanedFiles,
    },
  };
};