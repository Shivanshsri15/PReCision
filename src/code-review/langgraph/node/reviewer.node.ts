import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { PARALLEL_DOMAIN_KEYS, type DomainReport, type GraphState } from '../state.js';
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

export function buildAlreadyReportedBlock(state: GraphState): string {
  const lines = PARALLEL_DOMAIN_KEYS.flatMap(
    (domain) => state.domainReports?.[domain]?.findings ?? [],
  ).map((f) => `- ${f.file}${f.line ? `:${f.line}` : ''} ${f.issue}`);

  if (!lines.length) {
    return '';
  }

  return `ALREADY REPORTED by other reviewers (do not repeat these, even in different words):
${Array.from(new Set(lines)).join('\n')}

Report only NEW correctness bugs not covered above. Return an empty findings array if there are none.
`;
}

/**
 * Bug detection pass — runs after parallel domain reviews and joinNode shaping.
 */
export const bugDetectionReviewerNode = async (
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> => {
  const quality = state.domainReports?.quality;
  const security = state.domainReports?.security;
  const performance = state.domainReports?.performance;

  if (!quality || !security || !performance) {
    return {};
  }

  console.log(`${LOG_PREFIX} bugDetection node: invoking LLM for PR #${state.input.prId}`);

  const model = createGemini(config);
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);
  const addendum = state.bugDetectionPromptAddendum?.trim();
  const alreadyReported = buildAlreadyReportedBlock(state);

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
${alreadyReported}
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
