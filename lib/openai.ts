import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
