import { describe, expect, it } from "vitest";
import { assertPublicUrl, SafeFetchError } from "@/lib/safe-fetch";

describe("safe URL fetching", () => {
  it("rejects loopback destinations", async () => {
    await expect(assertPublicUrl(new URL("http://127.0.0.1:3000/admin"))).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("rejects credentialed URLs", async () => {
    await expect(assertPublicUrl(new URL("https://user:pass@example.com"))).rejects.toBeInstanceOf(SafeFetchError);
  });
});
