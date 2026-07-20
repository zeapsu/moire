import { NextResponse } from "next/server";
import { z } from "zod";
import { scanDocument } from "@/lib/scanner";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";

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

const requestSchema = z.object({ sections: z.array(sectionSchema).min(1).max(180) }).strict();

export async function POST(request: Request) {
  try {
    const rate = takeRateLimit(`scan:${clientAddress(request)}`, 20, 10 * 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many scans. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "The page could not be prepared for scanning." }, { status: 400 });
    const briefs = await scanDocument(parsed.data.sections as Parameters<typeof scanDocument>[0]);
    return NextResponse.json({ briefs });
  } catch (error) {
    console.error("Brief scan failed", error);
    return NextResponse.json(
      { error: error instanceof Error && error.message.includes("OPENAI_API_KEY") ? "Moiré is missing its OpenAI API key." : "The page scan failed. Try again." },
      { status: 500 },
    );
  }
}
