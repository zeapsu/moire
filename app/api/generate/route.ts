import { NextResponse } from "next/server";
import { z } from "zod";
import { ArtifactQueueFullError, generateArtifact, repairRuntimeFailure } from "@/lib/artifact";
import { briefSchema, emptyRepairState, repairStateSchema } from "@/lib/types";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z
  .object({
    brief: briefSchema,
    previousHtml: z.string().max(200 * 1024).optional(),
    runtimeError: z.string().min(1).max(500).optional(),
    repairState: repairStateSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.previousHtml, value.runtimeError, value.repairState].every(Boolean) ||
      [value.previousHtml, value.runtimeError, value.repairState].every((item) => !item),
    { message: "Runtime repair requires the prior artifact, its error, and repair state." },
  );

export async function POST(request: Request) {
  let responseRepairState = emptyRepairState();
  try {
    const rate = takeRateLimit(`generate:${clientAddress(request)}`, 12, 10 * 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many visualization requests. Try again shortly.", repairState: emptyRepairState() },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "The visualization brief is invalid." }, { status: 400 });

    const { brief, previousHtml, runtimeError, repairState } = parsed.data;
    if (repairState && runtimeError) {
      responseRepairState = { ...repairState, lastFailure: { stage: "runtime", message: runtimeError } };
    }
    const result =
      previousHtml && runtimeError && repairState
        ? await repairRuntimeFailure(brief, previousHtml, runtimeError, repairState)
        : await generateArtifact(brief);

    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("Artifact generation failed", error);
    if (error instanceof ArtifactQueueFullError) {
      return NextResponse.json(
        { ok: false, error: error.message, repairState: responseRepairState },
        { status: 503, headers: { "retry-after": "15" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error && error.message.includes("OPENAI_API_KEY") ? "Moiré is missing its OpenAI API key." : "The visualization could not be generated.", repairState: responseRepairState },
      { status: 500 },
    );
  }
}
