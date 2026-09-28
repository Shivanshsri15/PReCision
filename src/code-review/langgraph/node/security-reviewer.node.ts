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

export const securityReviewerNode = async (
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> => {
  const model = createGemini(config);
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);

  const prompt = `
You are a senior application security engineer doing a PR review focused on SECURITY.

Focus areas:
- authentication/authorization issues
- injection risks (SQL/NoSQL/command/path)
- secrets leakage, token handling, logging sensitive data
- SSRF, unsafe redirects, unsafe deserialization
- missing input validation on untrusted data

Analyze the following changes and return STRICT JSON only (no markdown/backticks/explanations).

PR TITLE:
${state.cleanedInput?.title ?? ''}

PR DESCRIPTION:
${state.cleanedInput?.description ?? ''}

FILES:
${filesText}
${relatedContext}
${buildReviewRules('security')}
${FINDING_SCHEMA}
`;

  const response = await model.invoke(prompt);
  const raw = extractModelTextContent(response);
  const parsed = parseStrictJson(
    raw,
    {
      rating: 3,
      summary: 'Security review completed.',
      weakAreas: [],
      findings: [],
    },
    'security',
  );

  const report: DomainReport = buildDomainReport({
    domain: 'security',
    parsed,
    fallbackSummary: 'Security review completed.',
  });

  logDomainComplete('security', report);

  return {
    domainReports: {
      security: report,
    },
  };
};
