import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ArtifactCacheFullError, registerArtifactBriefs } from "@/lib/artifact-cache";
import { scanDocument } from "@/lib/scanner";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";
import { normalizeTarget, TargetError } from "@/lib/target";

export const runtime = "nodejs";
export const maxDuration = 120;

const sectionSchema = z
  .object({
    selector: z.string().regex(/^#p-\d+$/),
    section: z.string().max(160),
    elementType: z.enum(["equation", "figure", "paragraph", "sentence"]),
    text: z.string().min(1).max(1800),
  })
  .strict();

export const scanRequestSchema = z
  .object({
    targetUrl: z.string().min(1).max(4096),
    selection: z.boolean().default(false),
    sections: z.array(sectionSchema).min(1).transform((sections) => sections.slice(0, 180)),
  })
  .strict()
  .refine((value) => !value.selection || value.sections.length === 1, {
    message: "A selected passage must contain exactly one source section.",
  });

export async function POST(request: Request) {
  try {
    const rate = takeRateLimit(`scan:${clientAddress(request)}`, 20, 10 * 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many scans. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The page could not be prepared for scanning." }, { status: 400 });
    }
    const parsed = scanRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "The page could not be prepared for scanning." }, { status: 400 });
    let targetUrl: string;
    try {
      targetUrl = normalizeTarget(parsed.data.targetUrl);
    } catch (error) {
      if (error instanceof TargetError) {
        return NextResponse.json({ error: "The page could not be prepared for scanning." }, { status: 400 });
      }
      throw error;
    }
    const briefs = await scanDocument(parsed.data.sections as Parameters<typeof scanDocument>[0]);
    const variantKey = parsed.data.selection
      ? createHash("sha256")
          .update(`${parsed.data.sections[0].selector}\u0000${parsed.data.sections[0].text}`)
          .digest("hex")
          .slice(0, 24)
      : undefined;
    const artifacts = registerArtifactBriefs(targetUrl, briefs, { variantKey });
    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("Brief scan failed", error);
    if (error instanceof ArtifactCacheFullError) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: { "retry-after": "15" } });
    }
    return NextResponse.json(
      { error: error instanceof Error && error.message.includes("OPENAI_API_KEY") ? "Moiré is missing its OpenAI API key." : "The page scan failed. Try again." },
      { status: 500 },
    );
  }
}
