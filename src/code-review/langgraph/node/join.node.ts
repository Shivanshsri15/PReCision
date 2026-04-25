import type { GraphState } from "../state.js";

const LOW_RATING_THRESHOLD = 2;

export const joinNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const quality = state.domainReports?.quality;
  const security = state.domainReports?.security;
  const performance = state.domainReports?.performance;

  // Wait until all domain reports exist.
  if (!quality || !security || !performance) {
    return {};
  }

  const weakAreas = [
    ...(quality.rating <= LOW_RATING_THRESHOLD ? (quality.weakAreas ?? []) : []),
    ...(security.rating <= LOW_RATING_THRESHOLD ? (security.weakAreas ?? []) : []),
    ...(performance.rating <= LOW_RATING_THRESHOLD
      ? (performance.weakAreas ?? [])
      : []),
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  const uniqueWeakAreas = Array.from(new Set(weakAreas)).slice(0, 12);

  const extraPrompt = state.cleanedInput?.extraPrompt?.trim();

  const addendumParts: string[] = [];
  if (uniqueWeakAreas.length) {
    addendumParts.push(
      `Double-check these weak areas carefully: ${uniqueWeakAreas.join(", ")}.`,
    );
  }
  if (extraPrompt) {
    addendumParts.push(
      `User focus prompt (apply where relevant): ${extraPrompt}`,
    );
  }

  const bugDetectionPromptAddendum = addendumParts.join("\n");

  return {
    bugDetectionPromptAddendum,
  };
};

