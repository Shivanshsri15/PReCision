import { DOMAIN_KEYS, type GraphState } from '../state.js';

const LOG_PREFIX = '[code-review]';

/** Barrier after the parallel reviewers; records the user focus prompt for the report. */
export const joinNode = (state: GraphState): Partial<GraphState> => {
  const done = DOMAIN_KEYS.filter((domain) => state.domainReports?.[domain]);
  const extraPrompt = state.cleanedInput?.extraPrompt?.trim();

  console.log(
    `${LOG_PREFIX} joinNode: reviewers=${done.join(',')} extraPrompt=${extraPrompt ? 'yes' : 'no'}`,
  );

  return {
    bugDetectionPromptAddendum: extraPrompt
      ? `User focus prompt (apply where relevant): ${extraPrompt}`
      : '',
  };
};
