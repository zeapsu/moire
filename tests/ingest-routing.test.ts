import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeFetchHtml = vi.hoisted(() => vi.fn());
vi.mock("@/lib/safe-fetch", () => ({ safeFetchHtml }));

import { ARXIV_ERROR, READABILITY_ERROR, ingestTarget } from "@/lib/ingest";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  safeFetchHtml.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("arXiv ingest routing", () => {
  it("tries both HTML sources for legacy identifiers but rejects abstract-page fallbacks", async () => {
    safeFetchHtml
      .mockResolvedValueOnce({
        html: "<!doctype html><html><body><article><p>Only an abstract page.</p></article></body></html>",
        finalUrl: "https://arxiv.org/abs/hep-th/9901001",
      })
      .mockResolvedValueOnce({
        html: "<!doctype html><html><body><article><p>Only an abstract page.</p></article></body></html>",
        finalUrl: "https://arxiv.org/abs/hep-th/9901001",
      });

    await expect(ingestTarget("https://arxiv.org/abs/hep-th/9901001")).rejects.toThrow(ARXIV_ERROR);
    expect(safeFetchHtml).toHaveBeenNthCalledWith(1, "https://arxiv.org/html/hep-th/9901001");
    expect(safeFetchHtml).toHaveBeenNthCalledWith(2, "https://ar5iv.labs.arxiv.org/html/hep-th/9901001");
    expect(consoleError).toHaveBeenCalledWith("arXiv ingest failed", {
      arxivId: "hep-th/9901001",
      failures: [
        {
          source: "https://arxiv.org/html/hep-th/9901001",
          error: { name: "Error", message: "The HTML source redirected outside its expected route." },
        },
        {
          source: "https://ar5iv.labs.arxiv.org/html/hep-th/9901001",
          error: { name: "Error", message: "The HTML source redirected outside its expected route." },
        },
      ],
    });
  });

  it("logs only the origin and normalized error for readable-page failures", async () => {
    const failure = new Error("The page took too long to respond.");
    failure.name = "SafeFetchError";
    safeFetchHtml.mockRejectedValueOnce(failure);

    await expect(ingestTarget("https://example.com/paper?private-token=secret")).rejects.toThrow(READABILITY_ERROR);
    expect(consoleError).toHaveBeenCalledWith("Readable page ingest failed", {
      origin: "https://example.com",
      error: { name: "SafeFetchError", message: "The page took too long to respond." },
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });
});
