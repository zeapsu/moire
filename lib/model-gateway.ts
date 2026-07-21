import OpenAI from "openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const MODEL_ROUTES = {
  scanner: "openai/gpt-5.6-luna",
  artifact: "x-ai/grok-4.5",
  fallback: "openai/gpt-5.6-terra",
  repair: "openai/gpt-5.6-sol",
} as const;
export const ARTIFACT_REASONING_EFFORT = "high" as const;
export const ARTIFACT_MAX_OUTPUT_TOKENS = 20_000;
export const ARTIFACT_OUTPUT_LIMIT_RETRY_TOKENS = 32_000;

let client: OpenAI | undefined;

export class ModelGatewayConfigurationError extends Error {}

export function modelMatchesRoute(actualModel: string, configuredModel: string): boolean {
  const normalized = (model: string) => model.trim().toLocaleLowerCase().split("/").at(-1);
  return normalized(actualModel) === normalized(configuredModel);
}

export function getModelGateway(): OpenAI {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new ModelGatewayConfigurationError("OPENROUTER_API_KEY is not configured.");
  }
  client ??= new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": "https://moire-umber.vercel.app",
      "X-Title": "Moiré",
      "X-OpenRouter-Metadata": "enabled",
    },
  });
  return client;
}
