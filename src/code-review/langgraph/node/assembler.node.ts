import { GraphState } from "../state.js";

export const assemblerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const summary = `Found ${state.findings?.length || 0} issues in PR`;

  return {
    finalReport: {
      prId: state.input.prId,
      summary,
      findings: state.findings || [],
    },
  };
};