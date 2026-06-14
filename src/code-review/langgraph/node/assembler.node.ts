import { GraphState } from '../state.js';

const LOG_PREFIX = '[code-review]';

export const assemblerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const findingCount = state.findings?.length || 0;
  const summary = `Found ${findingCount} issues in PR`;

  console.log(
    `${LOG_PREFIX} assembler node: PR #${state.input.prId} ` +
      `findings=${findingCount} relatedContext=${state.relatedContext?.length ?? 0}`,
  );

  return {
    finalReport: {
      prId: state.input.prId,
      summary,
      findings: state.findings || [],
      relatedContextCount: state.relatedContext?.length ?? 0,
    },
  };
};
