import { PARALLEL_DOMAIN_KEYS, type GraphState } from '../state.js';

const LOG_PREFIX = '[code-review]';

const LOW_RATING_THRESHOLD = 2;

export const joinNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const quality = state.domainReports?.quality;
  const security = state.domainReports?.security;
  const performance = state.domainReports?.performance;

  if (!quality || !security || !performance) {
    return {};
  }

  const weakAreas = PARALLEL_DOMAIN_KEYS.flatMap((domain) => {
    const report = state.domainReports?.[domain];
    if (!report || report.rating > LOW_RATING_THRESHOLD) {
      return [];
    }
    return report.weakAreas ?? [];
  })
    .map((area) => area.trim())
    .filter(Boolean);

  const uniqueWeakAreas = Array.from(new Set(weakAreas)).slice(0, 12);
  const extraPrompt = state.cleanedInput?.extraPrompt?.trim();

  const addendumParts: string[] = [];
  if (uniqueWeakAreas.length) {
    addendumParts.push(
      `Double-check these weak areas carefully: ${uniqueWeakAreas.join(', ')}.`,
    );
  }
  if (extraPrompt) {
    addendumParts.push(`User focus prompt (apply where relevant): ${extraPrompt}`);
  }

  console.log(
    `${LOG_PREFIX} joinNode: weakAreas=${uniqueWeakAreas.length} extraPrompt=${extraPrompt ? 'yes' : 'no'}`,
  );

  return {
    bugDetectionPromptAddendum: addendumParts.join('\n'),
  };
};
