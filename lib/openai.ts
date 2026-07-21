import OpenAI from "openai";

let client: OpenAI | undefined;

export class OpenAIConfigurationError extends Error {}

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new OpenAIConfigurationError("OPENAI_API_KEY is not configured.");
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
