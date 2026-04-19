import { GraphState } from "../state.js";
import { createGemini } from "../gemini.factory.js";

export const reviewerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const model = createGemini();

  const filesText = state.cleanedInput?.files
    .map(
      (f) => `
FILE: ${f.filename}

PATCH:
${f.patch || ""}

CONTENT:
${f.content || ""}
`
    )
    .join("\n------------------\n");

  const prompt = `
You are a senior software engineer doing a PR review.

Analyze the following changes and return STRICT JSON only.

PR TITLE:
${state.cleanedInput?.title}

FILES:
${filesText}

Return ONLY this JSON structure with no markdown, no backticks, no explanation:
{
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

  const rawContent =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
      ? response.content.map((c: any) => c.text ?? "").join("")
      : "";

  const cleaned = rawContent
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse LLM response:", cleaned);
    parsed = { findings: [] };
  }

  return {
    findings: parsed.findings || [],
  };
};