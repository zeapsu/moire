import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/artifact", () => {
  class ArtifactQueueFullError extends Error {}
  return {
    ArtifactQueueFullError,
    generateArtifact: vi.fn(async () => {
      throw new ArtifactQueueFullError("The visualization queue is full. Try again shortly.");
    }),
    repairRuntimeFailure: vi.fn(),
  };
});

import { POST } from "@/app/api/generate/route";

const brief = {
  span_id: "s-1",
  anchor: { section: "Paper", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A useful passage" },
  title: "Test artifact",
  concept: "A test concept",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "x",
  parameters: [{ name: "Speed", symbol: "v", default: 1, min: 0, max: 2, unit: "m/s" }],
  expected_behavior: "The plot changes with speed.",
  score: 0.9,
} as const;

describe("artifact generation route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a retryable response when the shared generation queue is full", async () => {
    const request = new Request("https://moire.test/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${Date.now() % 255}` },
      body: JSON.stringify({ brief }),
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("15");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "The visualization queue is full. Try again shortly.",
    });
  });
});
