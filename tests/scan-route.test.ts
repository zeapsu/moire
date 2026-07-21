import { beforeEach, describe, expect, it } from "vitest";
import { POST, scanRequestSchema } from "@/app/api/scan/route";
import { resetArtifactCacheForTests } from "@/lib/artifact-cache";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

describe("scan request validation", () => {
  beforeEach(() => {
    resetArtifactCacheForTests();
    resetRateLimitsForTests();
  });

  it("accepts long documents so the scanner can truncate and chunk them", () => {
    const sections = Array.from({ length: 300 }, (_, index) => ({
      selector: `#p-${index + 1}`,
      section: "Paper",
      elementType: "paragraph" as const,
      text: `Candidate section ${index + 1}`,
    }));
    const parsed = scanRequestSchema.safeParse({ targetUrl: "https://example.com/paper", sections });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sections).toHaveLength(180);
  });

  it("requires a selected passage to contain exactly one section", () => {
    const section = {
      selector: "#p-1",
      section: "Paper",
      elementType: "paragraph" as const,
      text: "A selected passage",
    };
    expect(
      scanRequestSchema.safeParse({
        targetUrl: "https://example.com/paper",
        selection: true,
        sections: [section, { ...section, selector: "#p-2" }],
      }).success,
    ).toBe(false);
  });

  it("returns 400 for malformed JSON and invalid targets", async () => {
    const malformed = await POST(
      new Request("https://moire.test/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(malformed.status).toBe(400);

    const invalidTarget = await POST(
      new Request("https://moire.test/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUrl: "http://[invalid",
          sections: [{ selector: "#p-1", section: "Paper", elementType: "paragraph", text: "Test passage" }],
        }),
      }),
    );
    expect(invalidTarget.status).toBe(400);
  });

  it("hydrates the browser with validated ready artifacts in the scan response", async () => {
    const response = await POST(
      new Request("https://moire.test/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUrl: "https://arxiv.org/abs/1706.03762",
          sections: [
            {
              selector: "#p-1",
              section: "Attention",
              elementType: "paragraph",
              text: "We apply softmax after we divide the query-key dot products by the square root of their dimension.",
            },
            {
              selector: "#p-2",
              section: "Attention",
              elementType: "paragraph",
              text: "Multi-head attention performs several projected attention functions in parallel.",
            },
            {
              selector: "#p-3",
              section: "Positional Encoding",
              elementType: "paragraph",
              text: "Positional encodings inject information about token order into a model without recurrence.",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      artifacts: Array<{ artifactId: string; status: string }>;
      readyArtifacts: Array<{ artifactId: string; ok: boolean; html?: string; cached: boolean }>;
    };
    expect(payload.artifacts).toHaveLength(3);
    expect(payload.artifacts.every((artifact) => artifact.status === "ready")).toBe(true);
    expect(payload.readyArtifacts).toHaveLength(3);
    expect(
      payload.readyArtifacts.every(
        (artifact) => artifact.ok && artifact.cached && artifact.html?.toLowerCase().startsWith("<!doctype html>"),
      ),
    ).toBe(true);
    expect(payload.readyArtifacts.map((artifact) => artifact.artifactId)).toEqual(
      payload.artifacts.map((artifact) => artifact.artifactId),
    );
  });
});
