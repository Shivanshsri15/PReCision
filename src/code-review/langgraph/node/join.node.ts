import type { GraphState } from '../state.js';

const LOG_PREFIX = '[code-review]';

/**
 * Other domains' weakAreas are intentionally not forwarded: they steer
 * bugDetection into re-reporting security/performance findings.
 */
export const joinNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const quality = state.domainReports?.quality;
  const security = state.domainReports?.security;
  const performance = state.domainReports?.performance;

  if (!quality || !security || !performance) {
    return {};
  }

  const extraPrompt = state.cleanedInput?.extraPrompt?.trim();

  console.log(`${LOG_PREFIX} joinNode: extraPrompt=${extraPrompt ? 'yes' : 'no'}`);

  return {
    bugDetectionPromptAddendum: extraPrompt
      ? `User focus prompt (apply where relevant): ${extraPrompt}`
      : '',
  };
};
