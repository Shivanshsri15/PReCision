import type { DomainReport, GraphState } from "../state.js";
import { createGemini } from "../gemini.factory.js";
import {
  buildDomainReport,
  extractModelTextContent,
  parseStrictJson,
} from "./domain-review.util.js";

/**
 * BugDetection node.\n+ * Runs after domain nodes; prompt is dynamically strengthened using `bugDetectionPromptAddendum`.
 */
export const reviewerNode = async (
  state: GraphState,
): Promise<Partial<GraphState>> => {
  const quality = state.domainReports?.quality;
  const security = state.domainReports?.security;
  const performance = state.domainReports?.performance;

  // Barrier safety: if domain reviews haven't completed yet, skip LLM call.
  if (!quality || !security || !performance) {
    return {};
  }

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

  const addendum = state.bugDetectionPromptAddendum?.trim();

  const prompt = `
You are a senior software engineer doing BUG DETECTION in a PR review.\n+\n+Goal: find correctness bugs, edge-case failures, hidden regressions, and logic mistakes.\n+\n+${addendum ? `EXTRA FOCUS (derived from other domain reviews):\n${addendum}\n` : ""}
\n+Analyze the following changes and return STRICT JSON only (no markdown/backticks/explanations).\n+\n+PR TITLE:\n+${state.cleanedInput?.title ?? ""}\n+\n+PR DESCRIPTION:\n+${state.cleanedInput?.description ?? ""}\n+\n+FILES:\n+${filesText}\n+\n+Return ONLY this JSON structure:\n+{\n+  \"rating\": 1,\n+  \"summary\": \"string\",\n+  \"weakAreas\": [\"string\"],\n+  \"findings\": [\n+    {\n+      \"file\": \"string\",\n+      \"issue\": \"string\",\n+      \"severity\": \"low | medium | high\",\n+      \"suggestion\": \"string\"\n+    }\n+  ]\n+}\n+`;

  const response = await model.invoke(prompt);
  const raw = extractModelTextContent(response);
  const parsed = parseStrictJson(raw, {
    rating: 3,
    summary: "Bug detection review completed.",
    weakAreas: [],
    findings: [],
  });

  const report: DomainReport = buildDomainReport({
    domain: "bugDetection",
    parsed,
    fallbackSummary: "Bug detection review completed.",
  });

  return {
    // backward compatible: keep populating `findings` with bug-detection findings only
    findings: report.findings,
    domainReports: {
      ...(state.domainReports ?? {}),
      bugDetection: report,
    },
  };
};