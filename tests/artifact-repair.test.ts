import { beforeEach, describe, expect, it, vi } from "vitest";

const createResponse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openai", () => ({
  getOpenAI: () => ({ responses: { create: createResponse } }),
}));

import { generateArtifact, repairRuntimeFailure } from "@/lib/artifact";
import { emptyRepairState, type VisualizationBrief } from "@/lib/types";

const brief: VisualizationBrief = {
  span_id: "s-1",
  anchor: { section: "Paper", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A useful passage" },
  title: "Repair policy",
  concept: "A repair-state test",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "x",
  grounding_terms: ["passage"],
  references: [],
  parameters: [{ name: "Speed", symbol: "v", default: 1, min: 0, max: 2, unit: "m/s" }],
  expected_behavior: "The plot responds to speed.",
  score: 0.9,
};

const validArtifact = `<!doctype html><html><head><style>body{color:white}</style></head><body><main data-moire-layout><section data-moire-stage><canvas></canvas></section><section data-moire-controls><label data-moire-control>Speed<input id="speed" type="range"></label></section><section data-moire-caption><p>What you're seeing: speed changes the plot.</p></section></main><script>document.getElementById('speed').addEventListener('input',()=>{}); window.parent.postMessage({ready:true}, '*')</script></body></html>`;
const invalidArtifact = "<html><body>invalid</body></html>";

describe("stage-specific artifact repair policy", () => {
  beforeEach(() => createResponse.mockReset());

  it("returns an untouched repair state when the initial artifact validates", async () => {
    createResponse.mockResolvedValueOnce({ output_text: validArtifact });
    const result = await generateArtifact(brief);
    expect(result.ok).toBe(true);
    expect(result.repairState).toEqual(emptyRepairState());
    expect(createResponse).toHaveBeenCalledTimes(1);
  });

  it("allows one validation repair and retains its diagnostic", async () => {
    createResponse
      .mockResolvedValueOnce({ output_text: invalidArtifact })
      .mockResolvedValueOnce({ output_text: validArtifact });
    const result = await generateArtifact(brief);
    expect(result.ok).toBe(true);
    expect(result.repairState.attempts).toEqual({ validation: 1, runtime: 0 });
    expect(result.repairState.lastFailure?.stage).toBe("validation");
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it("allows a runtime repair after a validation repair, then makes a second runtime failure terminal", async () => {
    createResponse
      .mockResolvedValueOnce({ output_text: invalidArtifact })
      .mockResolvedValueOnce({ output_text: validArtifact })
      .mockResolvedValueOnce({ output_text: validArtifact });
    const generated = await generateArtifact(brief);
    if (!generated.ok) throw new Error(generated.error);

    const runtimeRepaired = await repairRuntimeFailure(
      brief,
      generated.html,
      "Artifact did not signal ready within 5 seconds.",
      generated.repairState,
    );
    expect(runtimeRepaired.ok).toBe(true);
    expect(runtimeRepaired.repairState.attempts).toEqual({ validation: 1, runtime: 1 });
    expect(runtimeRepaired.repairState.lastFailure).toEqual({
      stage: "runtime",
      message: "Artifact did not signal ready within 5 seconds.",
    });
    expect(createResponse).toHaveBeenCalledTimes(3);
    expect(createResponse.mock.calls[2]?.[0]?.input).toContain("failed browser execution");
    expect(createResponse.mock.calls[2]?.[0]?.input).toContain("Runtime diagnostics");

    if (!runtimeRepaired.ok) throw new Error(runtimeRepaired.error);
    const terminal = await repairRuntimeFailure(
      brief,
      runtimeRepaired.html,
      "Artifact failed again after runtime repair.",
      runtimeRepaired.repairState,
    );
    expect(terminal).toMatchObject({
      ok: false,
      repairState: {
        attempts: { validation: 1, runtime: 1 },
        lastFailure: { stage: "runtime", message: "Artifact failed again after runtime repair." },
      },
    });
    expect(createResponse).toHaveBeenCalledTimes(3);
  });

  it("makes a failed validation repair terminal after two total calls", async () => {
    createResponse
      .mockResolvedValueOnce({ output_text: invalidArtifact })
      .mockResolvedValueOnce({ output_text: invalidArtifact });
    const result = await generateArtifact(brief);
    expect(result.ok).toBe(false);
    expect(result.repairState.attempts).toEqual({ validation: 1, runtime: 0 });
    expect(result.repairState.lastFailure?.stage).toBe("validation");
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it("does not grant a validation retry to an invalid runtime-repair output", async () => {
    createResponse.mockResolvedValueOnce({ output_text: invalidArtifact });
    const result = await repairRuntimeFailure(
      brief,
      validArtifact,
      "Artifact threw during initialization.",
      emptyRepairState(),
    );
    expect(result.ok).toBe(false);
    expect(result.repairState.attempts).toEqual({ validation: 0, runtime: 1 });
    expect(result.repairState.lastFailure?.stage).toBe("validation");
    expect(createResponse).toHaveBeenCalledTimes(1);
  });
});
