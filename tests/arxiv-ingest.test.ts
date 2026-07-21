import { beforeEach, describe, expect, it, vi } from "vitest";

const { safeFetchHtmlMock } = vi.hoisted(() => ({ safeFetchHtmlMock: vi.fn() }));

vi.mock("@/lib/safe-fetch", () => ({ safeFetchHtml: safeFetchHtmlMock }));

import { ingestTarget } from "@/lib/ingest";

const paperHtml = `<!doctype html><html><body><article class="ltx_document"><h1 id="intro" class="ltx_title ltx_title_document">Accessible paper</h1><p class="ltx_p"><a href="https://arxiv.org/html/1706.03762v7#intro">Return to introduction</a>. This paragraph contains enough readable scientific explanation to become a stable visualization candidate in the paper.</p></article></body></html>`;

describe("arXiv HTML source preference", () => {
  beforeEach(() => safeFetchHtmlMock.mockReset());

  it("prefers official accessible arXiv HTML and preserves its layout vocabulary", async () => {
    safeFetchHtmlMock.mockResolvedValueOnce({
      html: paperHtml,
      finalUrl: "https://arxiv.org/html/1706.03762",
    });

    const document = await ingestTarget("https://arxiv.org/abs/1706.03762");

    expect(safeFetchHtmlMock).toHaveBeenCalledWith("https://arxiv.org/html/1706.03762");
    expect(document.siteName).toBe("arXiv · accessible HTML");
    expect(document.html).toContain('class="ltx_document"');
    expect(document.html).toContain('href="#p-2">Return to introduction</a>');
  });

  it("falls back to ar5iv only when official HTML is unavailable", async () => {
    safeFetchHtmlMock
      .mockRejectedValueOnce(new Error("official HTML unavailable"))
      .mockResolvedValueOnce({
        html: paperHtml,
        finalUrl: "https://ar5iv.labs.arxiv.org/html/1706.03762",
      });

    const document = await ingestTarget("https://arxiv.org/abs/1706.03762");

    expect(safeFetchHtmlMock).toHaveBeenNthCalledWith(1, "https://arxiv.org/html/1706.03762");
    expect(safeFetchHtmlMock).toHaveBeenNthCalledWith(2, "https://ar5iv.labs.arxiv.org/html/1706.03762");
    expect(document.siteName).toBe("arXiv · ar5iv fallback");
  });
});
