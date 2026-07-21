import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactResult, VisualizationBrief } from "@/lib/types";

const { generateArtifactMock, repairRuntimeFailureMock } = vi.hoisted(() => ({
  generateArtifactMock: vi.fn(),
  repairRuntimeFailureMock: vi.fn(),
}));

vi.mock("@/lib/artifact", () => {
  class ArtifactQueueFullError extends Error {}
  return {
    ARTIFACT_RUNTIME_BRIDGE_VERSION: "3",
    ArtifactQueueFullError,
    generateArtifact: generateArtifactMock,
    promoteArtifactTask: vi.fn(),
    repairRuntimeFailure: repairRuntimeFailureMock,
    withArtifactCsp: (html: string) => html,
  };
});

import { POST } from "@/app/api/generate/route";
import { registerArtifactBriefs, resetArtifactCacheForTests } from "@/lib/artifact-cache";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { emptyRepairState } from "@/lib/types";

const brief: VisualizationBrief = {
  span_id: "s-1",
  anchor: { section: "Paper", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A useful passage" },
  title: "Replay policy",
  concept: "A direct API replay test",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "x",
  grounding_terms: ["passage"],
  references: [],
  parameters: [{ name: "Speed", symbol: "v", default: 1, min: 0, max: 2, unit: "m/s" }],
  expected_behavior: "The plot responds to speed.",
  score: 0.9,
};

const initialResult: ArtifactResult = {
  ok: true,
  html: "<!doctype html><html><head></head><body>initial</body></html>",
  repairState: emptyRepairState(),
};

const repairedResult: ArtifactResult = {
  ok: true,
  html: "<!doctype html><html><head></head><body>repaired</body></html>",
  repairState: {
    attempts: { validation: 0, runtime: 1 },
    lastFailure: { stage: "runtime", message: "ready handshake timed out" },
  },
};

function request(body: object): Request {
  return new Request("https://moire.test/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("direct artifact repair replay", () => {
  beforeEach(() => {
    resetArtifactCacheForTests();
    resetRateLimitsForTests();
    generateArtifactMock.mockReset().mockResolvedValue(initialResult);
    repairRuntimeFailureMock.mockReset().mockResolvedValue(repairedResult);
  });

  it("rejects a repeated runtime repair without poisoning the validated artifact", async () => {
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);
    expect((await POST(request({ artifactId }))).status).toBe(200);
    expect((await POST(request({ artifactId, runtimeError: "ready handshake timed out" }))).status).toBe(200);

    const replay = await POST(request({ artifactId, runtimeError: "same request replayed" }));
    expect(replay.status).toBe(422);
    await expect(replay.json()).resolves.toMatchObject({
      ok: false,
      cached: true,
      artifactId,
      repairState: {
        attempts: { validation: 0, runtime: 1 },
        lastFailure: { stage: "runtime", message: "same request replayed" },
      },
    });
    expect(generateArtifactMock).toHaveBeenCalledTimes(1);
    expect(repairRuntimeFailureMock).toHaveBeenCalledTimes(1);

    const afterReplay = await POST(request({ artifactId }));
    expect(afterReplay.status).toBe(200);
    await expect(afterReplay.json()).resolves.toMatchObject({
      ok: true,
      cached: true,
      artifactId,
      html: repairedResult.html,
      repairState: {
        attempts: { validation: 0, runtime: 1 },
        lastFailure: { stage: "runtime", message: "same request replayed" },
      },
    });
    expect(generateArtifactMock).toHaveBeenCalledTimes(1);
  });
});
