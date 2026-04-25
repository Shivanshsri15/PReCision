import { createGemini } from "../gemini.factory.js";
import type { DomainReport, GraphState } from "../state.js";
import {
  buildDomainReport,
  extractModelTextContent,
  parseStrictJson,
} from "./domain-review.util.js";

export const securityReviewerNode = async (
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
You are a senior application security engineer doing a PR review focused on SECURITY.

Focus areas:
- authentication/authorization issues
- injection risks (SQL/NoSQL/command/path)
- secrets leakage, token handling, logging sensitive data
- SSRF, unsafe redirects, unsafe deserialization
- insecure defaults and missing validation

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
    summary: "Security review completed.",
    weakAreas: [],
    findings: [],
  });

  const report: DomainReport = buildDomainReport({
    domain: "security",
    parsed,
    fallbackSummary: "Security review completed.",
  });

  return {
    domainReports: {
      ...(state.domainReports ?? {}),
      security: report,
    },
  };
};

