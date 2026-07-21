import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRepairState } from "@/lib/types";

const { generateCachedArtifact, repairCachedArtifact } = vi.hoisted(() => ({
  generateCachedArtifact: vi.fn(),
  repairCachedArtifact: vi.fn(),
}));

vi.mock("@/lib/artifact", () => {
  class ArtifactQueueFullError extends Error {}
  return { ArtifactQueueFullError };
});

vi.mock("@/lib/artifact-cache", () => {
  class ArtifactNotFoundError extends Error {}
  class ArtifactNotReadyError extends Error {}
  return { ArtifactNotFoundError, ArtifactNotReadyError, generateCachedArtifact, repairCachedArtifact };
});

import { POST } from "@/app/api/generate/route";
import { ModelGatewayConfigurationError } from "@/lib/model-gateway";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const artifactId = "9ba8fd67-b0bb-445d-8a8e-803f2fb38079";

describe("artifact generation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it("returns a retryable response when the shared generation queue is full", async () => {
    const request = new Request("https://moire.test/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${Date.now() % 255}` },
      body: JSON.stringify({ artifactId }),
    });
    const { ArtifactQueueFullError } = await import("@/lib/artifact");
    generateCachedArtifact.mockRejectedValueOnce(
      new ArtifactQueueFullError("The visualization queue is full. Try again shortly."),
    );
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("15");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "The visualization queue is full. Try again shortly.",
    });
  });

  it("rejects client-supplied repair authority", async () => {
    const request = new Request("https://moire.test/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactId,
        previousHtml: "<html></html>",
        repairState: { attempts: { validation: 0, runtime: 0 }, lastFailure: null },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(generateCachedArtifact).not.toHaveBeenCalled();
    expect(repairCachedArtifact).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const request = new Request("https://moire.test/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(generateCachedArtifact).not.toHaveBeenCalled();
    expect(repairCachedArtifact).not.toHaveBeenCalled();
  });

  it("routes runtime diagnostics by opaque id only", async () => {
    repairCachedArtifact.mockResolvedValueOnce({
      ok: false,
      artifactId,
      cached: true,
      error: "The visualization could not start after its runtime repair.",
      repairState: {
        attempts: { validation: 0, runtime: 1 },
        lastFailure: { stage: "runtime", message: "ready handshake timed out" },
      },
    });
    const request = new Request("https://moire.test/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactId, runtimeError: "ready handshake timed out" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(422);
    expect(repairCachedArtifact).toHaveBeenCalledWith(artifactId, "ready handshake timed out");
    expect(generateCachedArtifact).not.toHaveBeenCalled();
  });

  it("keeps interactive capacity available when background prefetch reaches its own limit", async () => {
    generateCachedArtifact.mockResolvedValue({
      ok: true,
      artifactId,
      cached: false,
      html: "<!doctype html><html><body>ready</body></html>",
      repairState: emptyRepairState(),
    });
    const request = (intent: "interactive" | "prefetch") =>
      new Request("https://moire.test/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId, intent }),
      });

    for (let index = 0; index < 6; index += 1) {
      expect((await POST(request("prefetch"))).status).toBe(200);
    }
    expect((await POST(request("prefetch"))).status).toBe(429);
    expect((await POST(request("interactive"))).status).toBe(200);
  });

  it("maps the typed missing-key error without relying on message text", async () => {
    generateCachedArtifact.mockRejectedValueOnce(new ModelGatewayConfigurationError("configuration unavailable"));
    const response = await POST(
      new Request("https://moire.test/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "Moiré is missing its OpenRouter API key." });
  });
});
