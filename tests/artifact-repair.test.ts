import { beforeEach, describe, expect, it, vi } from "vitest";

const createResponse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/model-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model-gateway")>()),
  getModelGateway: () => ({ responses: { create: createResponse } }),
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

  it("records the initial model call when the first artifact validates", async () => {
    createResponse.mockResolvedValueOnce({ output_text: validArtifact });
    const result = await generateArtifact(brief);
    expect(result.ok).toBe(true);
    expect(result.repairState).toEqual({ ...emptyRepairState(), modelCalls: 1 });
    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(createResponse.mock.calls[0]?.[0]).toMatchObject({
      model: "x-ai/grok-4.5",
      models: ["openai/gpt-5.6-terra"],
      reasoning: { effort: "high" },
      max_output_tokens: 20_000,
    });
  });

  it.each([
    ["Responses incomplete status", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }],
    ["OpenRouter length finish", { finish_reason: "length" }],
    ["native max-tokens finish", { native_finish_reason: "MAX_TOKENS" }],
  ])("regenerates truncated output from the original brief for %s", async (_label, signal) => {
    createResponse
      .mockResolvedValueOnce({ output_text: "<!doctype html><html>", model: "x-ai/grok-4.5", ...signal })
      .mockResolvedValueOnce({ output_text: validArtifact, model: "x-ai/grok-4.5" });

    const result = await generateArtifact(brief);

    expect(result).toMatchObject({
      ok: true,
      repairState: {
        attempts: { validation: 0, runtime: 0 },
        modelCalls: 2,
        lastFailure: { stage: "generation" },
      },
    });
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(createResponse.mock.calls[1]?.[0]).toMatchObject({
      model: "x-ai/grok-4.5",
      models: ["openai/gpt-5.6-terra"],
      max_output_tokens: 32_000,
      input: createResponse.mock.calls[0]?.[0]?.input,
    });
    expect(createResponse.mock.calls[1]?.[0]?.input).not.toContain("invalid_artifact");
  });

  it("falls back directly to Terra when the bounded 32k regeneration is also truncated", async () => {
    const truncated = {
      output_text: "<!doctype html><html>",
      model: "x-ai/grok-4.5",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    createResponse
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce({ output_text: validArtifact, model: "openai/gpt-5.6-terra" });

    const result = await generateArtifact(brief);

    expect(result).toMatchObject({ ok: true, repairState: { modelCalls: 3 } });
    expect(createResponse).toHaveBeenCalledTimes(3);
    expect(createResponse.mock.calls[2]?.[0]).toMatchObject({
      model: "openai/gpt-5.6-terra",
      max_output_tokens: 32_000,
      input: createResponse.mock.calls[0]?.[0]?.input,
    });
    expect(createResponse.mock.calls[2]?.[0]).not.toHaveProperty("models");
    expect(createResponse.mock.calls[2]?.[0]?.input).not.toContain("invalid_artifact");

    if (!result.ok) throw new Error(result.error);
    const terminalRuntime = await repairRuntimeFailure(
      brief,
      result.html,
      "Artifact failed after output-limit recovery.",
      result.repairState,
    );
    expect(terminalRuntime).toMatchObject({ ok: false, repairState: { modelCalls: 3 } });
    expect(createResponse).toHaveBeenCalledTimes(3);
  });

  it("recognizes a provider-normalized fallback model without a redundant third call", async () => {
    const truncated = {
      output_text: "<!doctype html><html>",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    createResponse
      .mockResolvedValueOnce({ ...truncated, model: "x-ai/grok-4.5" })
      .mockResolvedValueOnce({ ...truncated, model: "gpt-5.6-terra" });

    const result = await generateArtifact(brief);

    expect(result).toMatchObject({ ok: false, repairState: { modelCalls: 2 } });
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it("uses the normal Sol repair when a completed 32k regeneration is structurally invalid", async () => {
    createResponse
      .mockResolvedValueOnce({
        output_text: "<!doctype html><html>",
        model: "x-ai/grok-4.5",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      })
      .mockResolvedValueOnce({ output_text: invalidArtifact, model: "x-ai/grok-4.5", status: "completed" })
      .mockResolvedValueOnce({ output_text: validArtifact, model: "openai/gpt-5.6-sol" });

    const result = await generateArtifact(brief);

    expect(result).toMatchObject({
      ok: true,
      repairState: { attempts: { validation: 1, runtime: 0 }, modelCalls: 3 },
    });
    expect(createResponse.mock.calls[2]?.[0]).toMatchObject({
      model: "openai/gpt-5.6-sol",
      max_output_tokens: 20_000,
    });
    expect(createResponse.mock.calls[2]?.[0]?.input).toContain("invalid_artifact");
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
    expect(createResponse.mock.calls[1]?.[0]).toMatchObject({
      model: "openai/gpt-5.6-sol",
      models: ["openai/gpt-5.6-terra"],
      reasoning: { effort: "high" },
      max_output_tokens: 20_000,
    });
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
    expect(createResponse.mock.calls[2]?.[0]).toMatchObject({
      model: "openai/gpt-5.6-sol",
      models: ["openai/gpt-5.6-terra"],
    });

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
