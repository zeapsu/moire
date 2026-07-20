import { describe, expect, it } from "vitest";
import { takeRateLimit } from "@/lib/rate-limit";

describe("model endpoint rate limits", () => {
  it("rejects requests after the window budget is consumed", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    expect(takeRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(takeRateLimit(key, 2, 60_000).allowed).toBe(true);
    const blocked = takeRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
