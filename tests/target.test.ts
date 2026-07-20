import { describe, expect, it } from "vitest";
import { extractArxivId, normalizeTarget, routeForTarget } from "@/lib/target";

describe("target normalization", () => {
  it("turns a bare arXiv ID into its canonical abstract URL", () => {
    expect(normalizeTarget("1706.03762")).toBe("https://arxiv.org/abs/1706.03762");
  });

  it("repairs the slash collapse produced by prefix routing", () => {
    expect(normalizeTarget("https:/en.wikipedia.org/wiki/Double_pendulum")).toBe(
      "https://en.wikipedia.org/wiki/Double_pendulum",
    );
    expect(normalizeTarget("https%3A/en.wikipedia.org/wiki/Double_pendulum")).toBe(
      "https://en.wikipedia.org/wiki/Double_pendulum",
    );
  });

  it("adds https when the scheme is missing", () => {
    expect(normalizeTarget("example.com/article")).toBe("https://example.com/article");
  });

  it("preserves encoded reserved characters in paths and query values", () => {
    expect(normalizeTarget("https://example.com/a%2Fb?q=a%26b%3Dc")).toBe(
      "https://example.com/a%2Fb?q=a%26b%3Dc",
    );
  });

  it("builds the literal prefix route", () => {
    expect(routeForTarget("1706.03762")).toBe("/https://arxiv.org/abs/1706.03762");
  });

  it("recognizes arXiv abstract and PDF URLs", () => {
    expect(extractArxivId("https://arxiv.org/abs/1706.03762")).toBe("1706.03762");
    expect(extractArxivId("https://arxiv.org/pdf/1706.03762.pdf")).toBe("1706.03762");
    expect(extractArxivId("https://arxiv.org/abs/hep-th/9901001")).toBe("hep-th/9901001");
    expect(normalizeTarget("hep-th/9901001")).toBe("https://arxiv.org/abs/hep-th/9901001");
  });
});
