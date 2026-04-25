import { GraphState } from "../state.js";

export const inputGuardNode = async (state: GraphState): Promise<GraphState> => {

  const cleanedFiles = state.input.files
    .filter((f) => f.patch || f.content)

  return {
    ...state,
    cleanedInput: {
      ...state.input,
      files: cleanedFiles,
    },
  };
};