import { NextResponse } from "next/server";
import { z } from "zod";
import { ArtifactQueueFullError } from "@/lib/artifact";
import {
  ArtifactNotFoundError,
  ArtifactNotReadyError,
  generateCachedArtifact,
  repairCachedArtifact,
} from "@/lib/artifact-cache";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";
import { ModelGatewayConfigurationError } from "@/lib/model-gateway";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z
  .object({
    artifactId: z.string().uuid(),
    intent: z.enum(["interactive", "prefetch"]).default("interactive"),
    runtimeError: z.string().min(1).max(500).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The visualization request is invalid." }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "The visualization request is invalid." }, { status: 400 });

    const { artifactId, intent, runtimeError } = parsed.data;
    const bucket = intent === "prefetch" && !runtimeError ? "prefetch" : "interactive";
    const rate = takeRateLimit(
      `generate:${bucket}:${clientAddress(request)}`,
      bucket === "prefetch" ? 6 : 12,
      10 * 60_000,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many visualization requests. Try again shortly." },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }
    const result = runtimeError
      ? await repairCachedArtifact(artifactId, runtimeError)
      : await generateCachedArtifact(artifactId, intent);

    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("Artifact generation failed", error);
    if (error instanceof ArtifactNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    if (error instanceof ArtifactNotReadyError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    if (error instanceof ArtifactQueueFullError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503, headers: { "retry-after": "15" } },
      );
    }
    if (error instanceof ModelGatewayConfigurationError) {
      return NextResponse.json({ ok: false, error: "Moiré is missing its OpenRouter API key." }, { status: 500 });
    }
    return NextResponse.json(
      { ok: false, error: "The visualization could not be generated." },
      { status: 500 },
    );
  }
}
