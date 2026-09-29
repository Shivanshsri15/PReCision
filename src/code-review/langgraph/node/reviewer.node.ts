import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { DomainReport, GraphState } from '../state.js';
import { createGemini } from '../gemini.factory.js';
import {
  buildDomainReport,
  buildFilesPromptSection,
  buildRelatedContextBlock,
  extractModelTextContent,
  logDomainComplete,
  parseStrictJson,
} from './domain-review.util.js';
import { FINDING_SCHEMA, buildReviewRules } from './review-schema.js';

const LOG_PREFIX = '[code-review]';

/**
 * Bug detection pass — runs in parallel with the quality, security and
 * performance reviewers; overlapping findings are dropped by the assembler.
 */
export const bugDetectionReviewerNode = async (
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> => {
  console.log(
    `${LOG_PREFIX} bugDetection node: invoking LLM for PR #${state.input.prId}`,
  );

  const model = createGemini(config);
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);
  const addendum = state.cleanedInput?.extraPrompt?.trim();

  const prompt = `
You are a senior software engineer doing BUG DETECTION in a PR review.

Goal: find correctness bugs, edge-case failures, hidden regressions, and logic mistakes.
Security, performance, and style issues are reviewed by other reviewers; do not report them.

${addendum ? `EXTRA FOCUS:\n${addendum}\n` : ''}
Analyze the following changes and return STRICT JSON only (no markdown/backticks/explanations).

PR TITLE:
${state.cleanedInput?.title ?? ''}

PR DESCRIPTION:
${state.cleanedInput?.description ?? ''}

FILES:
${filesText}
${relatedContext}
${buildReviewRules('bugDetection')}
${FINDING_SCHEMA}
`;

  const response = await model.invoke(prompt);
  const raw = extractModelTextContent(response);
  const parsed = parseStrictJson(
    raw,
    {
      rating: 3,
      summary: 'Bug detection review completed.',
      weakAreas: [],
      findings: [],
    },
    'bugDetection',
  );

  const report: DomainReport = buildDomainReport({
    domain: 'bugDetection',
    parsed,
    fallbackSummary: 'Bug detection review completed.',
  });

  logDomainComplete('bugDetection', report);

  return {
    findings: report.findings,
    domainReports: {
      bugDetection: report,
    },
  };
};

/** @deprecated Use bugDetectionReviewerNode */
export const reviewerNode = bugDetectionReviewerNode;
