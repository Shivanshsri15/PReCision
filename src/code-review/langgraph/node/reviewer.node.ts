import { GraphState } from '../state.js';
import { createGemini } from '../gemini.factory.js';

const LOG_PREFIX = '[code-review]';

export const reviewerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const fileCount = state.cleanedInput?.files.length ?? 0;
  const contextChars = state.relatedContextFormatted?.length ?? 0;
  console.log(
    `${LOG_PREFIX} reviewer node: invoking LLM for PR #${state.input.prId} ` +
      `files=${fileCount} relatedContext=${contextChars} chars`,
  );

  const model = createGemini();

  const filesText = state.cleanedInput?.files
    .map((file) => {
      const patch = file.patch?.trim();
      const body = patch
        ? `PATCH:\n${file.patch}`
        : `HEAD (new):\n${file.content}`;
      return `\nFILE: ${file.filename}\n\n${body}\n`;
    })
    .join('\n------------------\n');

  const relatedContext = state.relatedContextFormatted?.trim()
    ? `\n${state.relatedContextFormatted}\n`
    : '';

  const prompt = `
You are a senior software engineer doing a PR review.

Analyze the following changes and return STRICT JSON only.

PR TITLE:
${state.cleanedInput?.title}

FILES:
${filesText}
${relatedContext}
Use related context to detect cross-file breakage, duplicate utilities, missing tests, and architectural impact. Do not repeat findings about code already shown in FILES.

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
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((part: any) => part.text ?? '').join('')
        : '';

  const cleaned = rawContent
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  let parsed: { findings?: GraphState['findings'] };
  try {
    parsed = JSON.parse(cleaned);
    console.log(
      `${LOG_PREFIX} reviewer node complete: ${parsed.findings?.length ?? 0} findings`,
    );
  } catch {
    console.error(`${LOG_PREFIX} failed to parse LLM response:`, cleaned);
    parsed = { findings: [] };
  }

  return {
    findings: parsed.findings || [],
  };
};
