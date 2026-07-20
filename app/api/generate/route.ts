import { NextResponse } from "next/server";
import { z } from "zod";
import { ArtifactQueueFullError, generateArtifact, repairRuntimeFailure } from "@/lib/artifact";
import { briefSchema } from "@/lib/types";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z
  .object({
    brief: briefSchema,
    previousHtml: z.string().max(200 * 1024).optional(),
    runtimeError: z.string().max(500).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.previousHtml) === Boolean(value.runtimeError), {
    message: "Runtime repair requires both the prior artifact and its error.",
  });

export async function POST(request: Request) {
  try {
    const rate = takeRateLimit(`generate:${clientAddress(request)}`, 12, 10 * 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many visualization requests. Try again shortly.", repairUsed: false },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "The visualization brief is invalid." }, { status: 400 });

    const { brief, previousHtml, runtimeError } = parsed.data;
    const result =
      previousHtml && runtimeError
        ? await repairRuntimeFailure(brief, previousHtml, runtimeError)
        : await generateArtifact(brief);

    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("Artifact generation failed", error);
    if (error instanceof ArtifactQueueFullError) {
      return NextResponse.json(
        { ok: false, error: error.message, repairUsed: false },
        { status: 503, headers: { "retry-after": "15" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error && error.message.includes("OPENAI_API_KEY") ? "Moiré is missing its OpenAI API key." : "The visualization could not be generated.", repairUsed: false },
      { status: 500 },
    );
  }
}
