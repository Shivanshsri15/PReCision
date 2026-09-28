import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
/**
 * Gemini 2.5 "thinks" before answering by default, which dominates reviewer
 * latency. 0 disables it; raise GEMINI_THINKING_BUDGET to trade speed for depth.
 */
const DEFAULT_THINKING_BUDGET = 0;

function thinkingBudget(): number {
  const raw = Number(process.env.GEMINI_THINKING_BUDGET);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_THINKING_BUDGET;
}

/**
 * The user's Gemini key travels in `config.configurable.geminiApiKey` (set at
 * graph.invoke) rather than graph state, so it never lands in state/results.
 */
export function getGeminiApiKey(
  config?: LangGraphRunnableConfig,
): string | undefined {
  const key = config?.configurable?.geminiApiKey;
  return typeof key === 'string' && key ? key : process.env.GEMINI_API_KEY;
}

export const createGemini = (config?: LangGraphRunnableConfig) => {
  return new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    apiKey: getGeminiApiKey(config),
    temperature: 0,
    json: true,
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingBudget: thinkingBudget() },
  });
};
