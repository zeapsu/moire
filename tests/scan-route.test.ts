import { describe, expect, it } from "vitest";
import { scanRequestSchema } from "@/app/api/scan/route";

describe("scan request validation", () => {
  it("accepts long documents so the scanner can truncate and chunk them", () => {
    const sections = Array.from({ length: 300 }, (_, index) => ({
      selector: `#p-${index + 1}`,
      section: "Paper",
      elementType: "paragraph" as const,
      text: `Candidate section ${index + 1}`,
    }));
    const parsed = scanRequestSchema.safeParse({ sections });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sections).toHaveLength(180);
  });
});
