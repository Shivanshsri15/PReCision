import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const createGemini = () => {
  return new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
    json: true,
  });
};
