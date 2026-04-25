import { createGemini } from "../gemini.factory.js";
import type { DomainReport, GraphState } from "../state.js";
import {
  buildDomainReport,
  extractModelTextContent,
  parseStrictJson,
} from "./domain-review.util.js";

export const performanceReviewerNode = async (
  state: GraphState,
): Promise<Partial<GraphState>> => {
  const model = createGemini();

  const filesText =
    state.cleanedInput?.files
      ?.map(
        (f) => `
FILE: ${f.filename}

PATCH:
${f.patch || ""}

CONTENT:
${f.content || ""}
`,
      )
      .join("\n------------------\n") ?? "";

  const prompt = `
You are a senior software engineer doing a PR review focused on PERFORMANCE.

Focus areas:
- slow loops, unnecessary work, excessive allocations
- N+1 query patterns / inefficient DB usage
- expensive synchronous operations on request paths
- missing pagination/caching opportunities
- algorithmic complexity regressions

Analyze the following changes and return STRICT JSON only (no markdown/backticks/explanations).

PR TITLE:
${state.cleanedInput?.title ?? ""}

PR DESCRIPTION:
${state.cleanedInput?.description ?? ""}

FILES:
${filesText}

Return ONLY this JSON structure:
{
  "rating": 1,
  "summary": "string",
  "weakAreas": ["string"],
  "findings": [
    {
      "file": "string",
      "issue": "string",
      "severity": "low | medium | high",
      "suggestion": "string"
    }
  ]
}
`;

  const response = await model.invoke(prompt);
  const raw = extractModelTextContent(response);
  const parsed = parseStrictJson(raw, {
    rating: 3,
    summary: "Performance review completed.",
    weakAreas: [],
    findings: [],
  });

  const report: DomainReport = buildDomainReport({
    domain: "performance",
    parsed,
    fallbackSummary: "Performance review completed.",
  });

  return {
    domainReports: {
      ...(state.domainReports ?? {}),
      performance: report,
    },
  };
};

