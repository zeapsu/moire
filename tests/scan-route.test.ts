import { beforeEach, describe, expect, it } from "vitest";
import { POST, scanRequestSchema } from "@/app/api/scan/route";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

describe("scan request validation", () => {
  beforeEach(() => resetRateLimitsForTests());

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
});
