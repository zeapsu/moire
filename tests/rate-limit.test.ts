import { afterEach, describe, expect, it, vi } from "vitest";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";

describe("model endpoint rate limits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the proxy-appended address rather than a spoofable leftmost hop", () => {
    vi.stubEnv("VERCEL", "1");
    const first = new Request("https://moire.test", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.10" } });
    const rotated = new Request("https://moire.test", { headers: { "x-forwarded-for": "9.8.7.6, 203.0.113.10" } });
    expect(clientAddress(first)).toBe("203.0.113.10");
    expect(clientAddress(rotated)).toBe("203.0.113.10");
  });

  it("prefers the Vercel-owned forwarding header", () => {
    vi.stubEnv("VERCEL", "1");
    const request = new Request("https://moire.test", {
      headers: { "x-vercel-forwarded-for": "203.0.113.20", "x-forwarded-for": "spoofed" },
    });
    expect(clientAddress(request)).toBe("203.0.113.20");
  });

  it("ignores client-supplied forwarding headers outside Vercel", () => {
    vi.stubEnv("VERCEL", "0");
    const request = new Request("https://moire.test", {
      headers: { "x-vercel-forwarded-for": "spoofed", "x-forwarded-for": "also-spoofed", "x-real-ip": "still-spoofed" },
    });
    expect(clientAddress(request)).toBe("non-vercel");
  });

  it("rejects requests after the window budget is consumed", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    expect(takeRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(takeRateLimit(key, 2, 60_000).allowed).toBe(true);
    const blocked = takeRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
