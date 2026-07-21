import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisualizationBrief } from "@/lib/types";

const openAIMocks = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock("@/lib/model-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model-gateway")>()),
  getModelGateway: () => ({ responses: { parse: openAIMocks.parse } }),
}));

import { scanSelection } from "@/lib/scanner";

const section = {
  selector: "#p-7" as const,
  section: "Attention",
  elementType: "paragraph" as const,
  text: "Attention weights determine how strongly each value contributes to the output.",
};

const groundedBrief: VisualizationBrief = {
  span_id: "s-9",
  anchor: {
    section: "Attention",
    element_type: "paragraph",
    dom_selector: "#p-7",
    text_excerpt: section.text,
  },
  title: "Attention weights",
  concept: "How attention weights change each value's contribution",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "output = weight × value",
  grounding_terms: ["Attention weights", "each value", "output"],
  references: [],
  parameters: [{ name: "Weight", symbol: "w", default: 0.5, min: 0, max: 1, unit: "" }],
  expected_behavior: "Increasing the weight increases the value's contribution.",
  score: 0.9,
};

describe("selection scanner", () => {
  beforeEach(() => openAIMocks.parse.mockReset());

  it("returns one grounded brief for a sufficient selection", async () => {
    openAIMocks.parse.mockResolvedValue({
      output_parsed: { assessment: { status: "sufficient", reason: "One relationship is defined." }, briefs: [groundedBrief] },
    });

    const result = await scanSelection(section);

    expect(result.assessment.status).toBe("sufficient");
    expect(result.briefs).toHaveLength(1);
    expect(result.briefs[0].span_id).toBe("s-1");
    expect(openAIMocks.parse).toHaveBeenCalledOnce();
    expect(openAIMocks.parse.mock.calls[0][0]).toMatchObject({
      model: "openai/gpt-5.6-luna",
      reasoning: { effort: "low" },
    });
  });

  it.each(["too_narrow", "multiple_concepts"] as const)("discards briefs when the assessment is %s", async (status) => {
    openAIMocks.parse.mockResolvedValue({
      output_parsed: { assessment: { status, reason: "The passage is not focused." }, briefs: [groundedBrief] },
    });
    expect(await scanSelection(section)).toMatchObject({ assessment: { status }, briefs: [] });
  });

  it("rejects a sufficient-looking brief whose terminology is not grounded in the selection", async () => {
    openAIMocks.parse.mockResolvedValue({
      output_parsed: {
        assessment: { status: "sufficient", reason: "One relationship is defined." },
        briefs: [{ ...groundedBrief, grounding_terms: ["quantum flux"] }],
      },
    });
    expect(await scanSelection(section)).toMatchObject({ assessment: { status: "too_narrow" }, briefs: [] });
  });

  it("makes the semantic and 3D thresholds explicit in the model instructions", async () => {
    openAIMocks.parse.mockResolvedValue({ output_parsed: null });
    await scanSelection(section);
    const instructions = openAIMocks.parse.mock.calls[0][0].instructions as string;
    expect(instructions).toContain("exactly one self-contained interactive visualization");
    expect(instructions).toContain("spatial depth");
    expect(instructions).toContain("never use 3D as decoration");
  });
});
