import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ArtifactCacheFullError,
  primeCachedArtifacts,
  readyCachedArtifacts,
  registerArtifactBriefs,
  synchronizeArtifactBriefs,
} from "@/lib/artifact-cache";
import { scanDocument, scanSelection } from "@/lib/scanner";
import { seededArtifactsFor } from "@/lib/seeded-demos";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";
import { normalizeTarget, TargetError } from "@/lib/target";
import { ModelGatewayConfigurationError } from "@/lib/model-gateway";
import { assessSelection, type SelectionContext, type SelectionFocusAssessment } from "@/lib/selection-policy";

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

const selectionContextSchema = z
  .object({
    blockCount: z.number().int().min(1).max(180),
    sectionCount: z.number().int().min(1).max(180),
    headingCount: z.number().int().min(0).max(180),
    documentCharacters: z.number().int().min(1).max(5_000_000),
    elementTypes: z.array(z.enum(["equation", "figure", "paragraph", "sentence"])).min(1).max(4),
  })
  .strict();

export const scanRequestSchema = z
  .object({
    targetUrl: z.string().min(1).max(4096),
    selection: z.boolean().default(false),
    selectionContext: selectionContextSchema.optional(),
    sections: z.array(sectionSchema).min(1).transform((sections) => sections.slice(0, 180)),
  })
  .strict()
  .refine((value) => !value.selection || value.sections.length === 1, {
    message: "A selected passage must contain exactly one source section.",
  })
  .refine((value) => !value.selection || value.selectionContext !== undefined, {
    message: "A selected passage must include its structural context.",
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
    const sections = parsed.data.sections as Parameters<typeof scanDocument>[0];
    const seeded = parsed.data.selection ? null : seededArtifactsFor(targetUrl, sections);
    let selectionAssessment: SelectionFocusAssessment | undefined;
    let briefs;
    if (parsed.data.selection) {
      const deterministic = assessSelection(sections[0].text, parsed.data.selectionContext as SelectionContext);
      if (deterministic.status !== "eligible") {
        selectionAssessment = {
          status: deterministic.status === "too_narrow" ? "too_narrow" : "multiple_concepts",
          reason: deterministic.message,
        };
        return NextResponse.json({ artifacts: [], readyArtifacts: [], selectionAssessment });
      }
      const selected = await scanSelection(sections[0]);
      selectionAssessment = selected.assessment;
      briefs = selected.briefs;
    } else {
      briefs = seeded?.map((artifact) => artifact.brief) ?? (await scanDocument(sections));
    }
    const variantKey = parsed.data.selection
      ? createHash("sha256")
          .update(`${parsed.data.sections[0].selector}\u0000${parsed.data.sections[0].text}`)
          .digest("hex")
          .slice(0, 24)
      : undefined;
    const registered = registerArtifactBriefs(targetUrl, briefs, {
      variantKey,
      kind: parsed.data.selection ? "selection" : "page",
    });
    let artifacts = await synchronizeArtifactBriefs(registered);
    if (seeded) {
      const currentSeedDescriptors = artifacts.map((artifact, index) => ({
        ...artifact,
        brief: seeded[index].brief,
      }));
      artifacts = await primeCachedArtifacts(
        currentSeedDescriptors,
        new Map(artifacts.map((artifact, index) => [artifact.artifactId, seeded[index].html])),
      );
    }
    return NextResponse.json({
      artifacts,
      readyArtifacts: readyCachedArtifacts(artifacts.slice(0, 3)),
      ...(selectionAssessment ? { selectionAssessment } : {}),
    });
  } catch (error) {
    console.error("Brief scan failed", error);
    if (error instanceof ArtifactCacheFullError) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: { "retry-after": "15" } });
    }
    if (error instanceof ModelGatewayConfigurationError) {
      return NextResponse.json({ error: "Moiré is missing its OpenRouter API key." }, { status: 500 });
    }
    return NextResponse.json(
      { error: "The page scan failed. Try again." },
      { status: 500 },
    );
  }
}
