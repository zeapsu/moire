import { describe, expect, it, vi } from "vitest";

const safeFetchHtml = vi.hoisted(() => vi.fn());
vi.mock("@/lib/safe-fetch", () => ({ safeFetchHtml }));

import { ARXIV_ERROR, ingestTarget } from "@/lib/ingest";

describe("arXiv ingest routing", () => {
  it("routes legacy identifiers through ar5iv but rejects an abstract-page fallback", async () => {
    safeFetchHtml.mockResolvedValueOnce({
      html: "<!doctype html><html><body><article><p>Only an abstract page.</p></article></body></html>",
      finalUrl: "https://arxiv.org/abs/hep-th/9901001",
    });

    await expect(ingestTarget("https://arxiv.org/abs/hep-th/9901001")).rejects.toThrow(ARXIV_ERROR);
    expect(safeFetchHtml).toHaveBeenCalledWith("https://ar5iv.labs.arxiv.org/html/hep-th/9901001");
  });
});
