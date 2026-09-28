import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { createGemini } from '../gemini.factory.js';
import type { DomainReport, GraphState } from '../state.js';
import {
  buildDomainReport,
  buildFilesPromptSection,
  buildRelatedContextBlock,
  extractModelTextContent,
  logDomainComplete,
  parseStrictJson,
} from './domain-review.util.js';
import { FINDING_SCHEMA, buildReviewRules } from './review-schema.js';

export const qualityReviewerNode = async (
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> => {
  const model = createGemini(config);
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);

  const prompt = `
You are a senior software engineer doing a PR review focused on CODE QUALITY.

Focus areas:
- readability, naming, maintainability
- dead code and duplicated logic
- API design clarity and consistency

Security, performance, and correctness bugs are reviewed by other reviewers; do not report them.

Analyze the following changes and return STRICT JSON only (no markdown/backticks/explanations).

PR TITLE:
${state.cleanedInput?.title ?? ''}

PR DESCRIPTION:
${state.cleanedInput?.description ?? ''}

FILES:
${filesText}
${relatedContext}
${buildReviewRules('quality')}
${FINDING_SCHEMA}
`;

  const response = await model.invoke(prompt);
  const raw = extractModelTextContent(response);
  const parsed = parseStrictJson(
    raw,
    {
      rating: 3,
      summary: 'Code quality review completed.',
      weakAreas: [],
      findings: [],
    },
    'quality',
  );

  const report: DomainReport = buildDomainReport({
    domain: 'quality',
    parsed,
    fallbackSummary: 'Code quality review completed.',
  });

  logDomainComplete('quality', report);

  return {
    domainReports: {
      quality: report,
    },
  };
};
