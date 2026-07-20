import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactResult, VisualizationBrief } from "@/lib/types";

const { generateArtifactMock, promoteArtifactTaskMock, repairRuntimeFailureMock } = vi.hoisted(() => ({
  generateArtifactMock: vi.fn(),
  promoteArtifactTaskMock: vi.fn(),
  repairRuntimeFailureMock: vi.fn(),
}));

vi.mock("@/lib/artifact", () => ({
  ArtifactQueueFullError: class ArtifactQueueFullError extends Error {},
  generateArtifact: generateArtifactMock,
  promoteArtifactTask: promoteArtifactTaskMock,
  repairRuntimeFailure: repairRuntimeFailureMock,
}));

import {
  ArtifactNotFoundError,
  generateCachedArtifact,
  registerArtifactBriefs,
  repairCachedArtifact,
  resetArtifactCacheForTests,
} from "@/lib/artifact-cache";
import { emptyRepairState } from "@/lib/types";

const brief: VisualizationBrief = {
  span_id: "s-1",
  anchor: { section: "Paper", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A useful passage" },
  title: "Cache policy",
  concept: "A cache test",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "x",
  parameters: [{ name: "Speed", symbol: "v", default: 1, min: 0, max: 2, unit: "m/s" }],
  expected_behavior: "The plot responds to speed.",
  score: 0.9,
};

const validResult: ArtifactResult = {
  ok: true,
  html: "<!doctype html><html><head></head><body>ready</body></html>",
  repairState: emptyRepairState(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("server-owned artifact cache", () => {
  beforeEach(() => {
    resetArtifactCacheForTests();
    generateArtifactMock.mockReset();
    promoteArtifactTaskMock.mockReset();
    repairRuntimeFailureMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses an opaque artifact id for the same normalized URL and anchor", () => {
    const first = registerArtifactBriefs("https://example.com/paper#section", [brief]);
    const second = registerArtifactBriefs("https://example.com/paper", [{ ...brief, title: "Rescanned" }]);
    const otherTarget = registerArtifactBriefs("https://example.com/other", [brief]);

    expect(first[0].artifactId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second[0].artifactId).toBe(first[0].artifactId);
    expect(otherTarget[0].artifactId).not.toBe(first[0].artifactId);
  });

  it("uses a stable variant key to distinguish selected ranges on the same anchor", () => {
    const page = registerArtifactBriefs("https://example.com/paper", [brief]);
    const selection = registerArtifactBriefs("https://example.com/paper", [brief], { variantKey: "selection-a" });
    const selectionReplay = registerArtifactBriefs("https://example.com/paper", [brief], { variantKey: "selection-a" });
    const otherSelection = registerArtifactBriefs("https://example.com/paper", [brief], { variantKey: "selection-b" });

    expect(selection[0].artifactId).not.toBe(page[0].artifactId);
    expect(selectionReplay[0].artifactId).toBe(selection[0].artifactId);
    expect(otherSelection[0].artifactId).not.toBe(selection[0].artifactId);
  });

  it("expires idle artifact ids after the process cache TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);

    vi.advanceTimersByTime(60 * 60_000 + 1);
    await expect(generateCachedArtifact(artifactId)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(generateArtifactMock).not.toHaveBeenCalled();
  });

  it("keeps the process cache capped by evicting the least-recent idle record", async () => {
    let firstArtifactId = "";
    for (let index = 1; index <= 121; index += 1) {
      const [registered] = registerArtifactBriefs("https://example.com/paper", [
        {
          ...brief,
          span_id: `s-${index}`,
          anchor: { ...brief.anchor, dom_selector: `#p-${index}` },
        },
      ]);
      if (index === 1) firstArtifactId = registered.artifactId;
    }

    await expect(generateCachedArtifact(firstArtifactId)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(generateArtifactMock).not.toHaveBeenCalled();
  });

  it("atomically deduplicates concurrent initial generation", async () => {
    const generation = deferred<ArtifactResult>();
    generateArtifactMock.mockReturnValueOnce(generation.promise);
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);

    const first = generateCachedArtifact(artifactId);
    const replay = generateCachedArtifact(artifactId);
    expect(generateArtifactMock).toHaveBeenCalledTimes(1);
    expect(promoteArtifactTaskMock).toHaveBeenCalledWith(artifactId);

    generation.resolve(validResult);
    await expect(first).resolves.toMatchObject({ ok: true, artifactId, cached: false });
    await expect(replay).resolves.toMatchObject({ ok: true, artifactId, cached: true });
  });

  it("keeps a terminal validation failure cached without another model pipeline", async () => {
    generateArtifactMock.mockResolvedValueOnce({
      ok: false,
      error: "validation failed",
      repairState: {
        attempts: { validation: 1, runtime: 0 },
        lastFailure: { stage: "validation", message: "still invalid" },
      },
    });
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);

    await expect(generateCachedArtifact(artifactId)).resolves.toMatchObject({ ok: false, cached: false });
    await expect(generateCachedArtifact(artifactId)).resolves.toMatchObject({ ok: false, cached: true });
    expect(generateArtifactMock).toHaveBeenCalledTimes(1);
  });

  it("terminally caches a started generation pipeline that throws", async () => {
    generateArtifactMock.mockRejectedValueOnce(new Error("upstream connection ended"));
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);

    await expect(generateCachedArtifact(artifactId)).resolves.toMatchObject({
      ok: false,
      cached: false,
      error: "The visualization generation failed before it produced an artifact.",
    });
    await expect(generateCachedArtifact(artifactId)).resolves.toMatchObject({ ok: false, cached: true });
    expect(generateArtifactMock).toHaveBeenCalledTimes(1);
  });

  it("claims the runtime budget before awaiting and makes replays terminal", async () => {
    generateArtifactMock.mockResolvedValueOnce(validResult);
    const repair = deferred<ArtifactResult>();
    repairRuntimeFailureMock.mockReturnValueOnce(repair.promise);
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);
    await generateCachedArtifact(artifactId);

    const firstRepair = repairCachedArtifact(artifactId, "ready handshake timed out");
    const replay = repairCachedArtifact(artifactId, "replayed failure");
    expect(repairRuntimeFailureMock).toHaveBeenCalledTimes(1);
    await expect(replay).resolves.toMatchObject({
      ok: false,
      cached: true,
      repairState: {
        attempts: { validation: 0, runtime: 1 },
        lastFailure: { stage: "runtime", message: "replayed failure" },
      },
    });

    repair.resolve(validResult);
    await expect(firstRepair).resolves.toMatchObject({
      ok: true,
      cached: false,
      repairState: { attempts: { validation: 0, runtime: 1 } },
    });
    await expect(repairCachedArtifact(artifactId, "failed after repair")).resolves.toMatchObject({
      ok: false,
      cached: true,
    });
    await expect(generateCachedArtifact(artifactId)).resolves.toMatchObject({
      ok: false,
      cached: true,
      repairState: { attempts: { validation: 0, runtime: 1 } },
    });
    expect(repairRuntimeFailureMock).toHaveBeenCalledTimes(1);
  });

  it("terminally caches a runtime repair pipeline that rejects", async () => {
    generateArtifactMock.mockResolvedValueOnce(validResult);
    repairRuntimeFailureMock.mockRejectedValueOnce(new Error("repair connection ended"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [{ artifactId }] = registerArtifactBriefs("https://example.com/paper", [brief]);
    await generateCachedArtifact(artifactId);

    await expect(repairCachedArtifact(artifactId, "ready handshake timed out")).resolves.toMatchObject({
      ok: false,
      cached: false,
      error: "The visualization runtime repair could not be completed.",
      repairState: { attempts: { validation: 0, runtime: 1 } },
    });
    await expect(generateCachedArtifact(artifactId)).resolves.toMatchObject({ ok: false, cached: true });
    expect(repairRuntimeFailureMock).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });
});
