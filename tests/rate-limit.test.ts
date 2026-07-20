import { describe, expect, it } from "vitest";
import { clientAddress, takeRateLimit } from "@/lib/rate-limit";

describe("model endpoint rate limits", () => {
  it("uses the proxy-appended address rather than a spoofable leftmost hop", () => {
    const first = new Request("https://moire.test", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.10" } });
    const rotated = new Request("https://moire.test", { headers: { "x-forwarded-for": "9.8.7.6, 203.0.113.10" } });
    expect(clientAddress(first)).toBe("203.0.113.10");
    expect(clientAddress(rotated)).toBe("203.0.113.10");
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
