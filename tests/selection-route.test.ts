import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionScan, VisualizationBrief } from "@/lib/types";

const scannerMocks = vi.hoisted(() => ({ scanDocument: vi.fn(), scanSelection: vi.fn() }));
vi.mock("@/lib/scanner", () => scannerMocks);

import { POST } from "@/app/api/scan/route";
import { resetArtifactCacheForTests } from "@/lib/artifact-cache";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const section = {
  selector: "#p-1" as const,
  section: "Results",
  elementType: "paragraph" as const,
  text: "Increasing the control parameter makes the measured response rise smoothly.",
};
const context = {
  blockCount: 1,
  sectionCount: 1,
  headingCount: 0,
  documentCharacters: 10_000,
  elementTypes: ["paragraph"] as const,
};
const brief: VisualizationBrief = {
  span_id: "s-1",
  anchor: { section: "Results", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: section.text },
  title: "Measured response",
  concept: "How the measured response changes with the control parameter",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "response = f(control parameter)",
  grounding_terms: ["control parameter", "measured response", "rise smoothly"],
  references: [],
  parameters: [{ name: "Control parameter", symbol: "c", default: 0.5, min: 0, max: 1, unit: "" }],
  expected_behavior: "The measured response rises as the control parameter increases.",
  score: 0.9,
};

function request(text = section.text, selectionContext: object | null = context) {
  return new Request("https://moire.test/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetUrl: "https://example.com/article",
      selection: true,
      ...(selectionContext !== null ? { selectionContext } : {}),
      sections: [{ ...section, text }],
    }),
  });
}

describe("selection scan route", () => {
  beforeEach(() => {
    scannerMocks.scanDocument.mockReset();
    scannerMocks.scanSelection.mockReset();
    resetArtifactCacheForTests();
    resetRateLimitsForTests();
  });

  it("rejects a tiny fragment without making a model call", async () => {
    const response = await POST(request("x"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      artifacts: [],
      selectionAssessment: { status: "too_narrow" },
    });
    expect(scannerMocks.scanSelection).not.toHaveBeenCalled();
  });

  it("rejects a page-scale selection without making a model call", async () => {
    const text = `${"a".repeat(250)} ${"b".repeat(250)}`;
    const response = await POST(request(text, { ...context, documentCharacters: 1_000 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      artifacts: [],
      selectionAssessment: { status: "multiple_concepts" },
    });
    expect(scannerMocks.scanSelection).not.toHaveBeenCalled();
  });

  it("uses one semantic scan and registers a sufficient focused selection", async () => {
    const scanned: SelectionScan = {
      assessment: { status: "sufficient", reason: "One relationship is defined." },
      briefs: [brief],
    };
    scannerMocks.scanSelection.mockResolvedValue(scanned);
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.selectionAssessment.status).toBe("sufficient");
    expect(payload.artifacts).toHaveLength(1);
    expect(scannerMocks.scanSelection).toHaveBeenCalledOnce();
  });

  it("returns a semantic focus warning without registering an artifact", async () => {
    scannerMocks.scanSelection.mockResolvedValue({
      assessment: { status: "multiple_concepts", reason: "Two separate processes are described." },
      briefs: [],
    });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      artifacts: [],
      selectionAssessment: { status: "multiple_concepts" },
    });
  });

  it("requires structural context for every selected passage", async () => {
    expect((await POST(request(section.text, null))).status).toBe(400);
    expect(scannerMocks.scanSelection).not.toHaveBeenCalled();
  });
});
