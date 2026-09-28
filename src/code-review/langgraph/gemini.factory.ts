import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * The user's Gemini key travels in `config.configurable.geminiApiKey` (set at
 * graph.invoke) rather than graph state, so it never lands in state/results.
 */
export function getGeminiApiKey(config?: LangGraphRunnableConfig): string | undefined {
  const key = config?.configurable?.geminiApiKey;
  return typeof key === "string" && key ? key : process.env.GEMINI_API_KEY;
}

export const createGemini = (config?: LangGraphRunnableConfig) => {
  return new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    apiKey: getGeminiApiKey(config),
    temperature: 0,
    json: true,
  });
};
