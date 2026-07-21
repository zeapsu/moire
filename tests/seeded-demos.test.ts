import { describe, expect, it } from "vitest";
import { validateArtifact } from "@/lib/artifact";
import { seededArtifactsFor } from "@/lib/seeded-demos";
import type { ScanSection } from "@/lib/types";

function sections(texts: string[]): ScanSection[] {
  return texts.map((text, index) => ({
    selector: `#p-${index + 1}`,
    section: "Seed",
    elementType: "paragraph",
    text,
  }));
}

function expectValidSeed(targetUrl: string, source: ScanSection[], expected: number): void {
  const seeded = seededArtifactsFor(targetUrl, source);
  expect(seeded).toHaveLength(expected);
  for (const artifact of seeded ?? []) {
    expect(artifact.brief.anchor.dom_selector).toMatch(/^#p-\d+$/);
    expect(validateArtifact(artifact.html, artifact.brief.render, artifact.brief.parameters.length)).toMatchObject({
      ok: true,
    });
  }
}

describe("curated demo registry", () => {
  it("provides three validated Transformer artifacts on source-matched anchors", () => {
    expectValidSeed(
      "https://arxiv.org/abs/1706.03762",
      sections([
        "We divide each query-key score before applying softmax.",
        "Multi-head attention consists of several attention layers running in parallel.",
        "Positional encodings inject information about token order.",
      ]),
      3,
    );
  });

  it("provides three validated Kibble-Zurek artifacts for the selected physics paper", () => {
    expectValidSeed(
      "https://arxiv.org/abs/1811.05327",
      sections([
        "The number of domains follows a power law in quench time.",
        "The freezing time identifies when evolution becomes non-adiabatic.",
        "The lower branch of the dispersion changes across the transition.",
      ]),
      3,
    );
  });

  it("provides a validated non-arXiv double-pendulum simulation", () => {
    expectValidSeed(
      "https://en.wikipedia.org/wiki/Double_pendulum",
      sections(["Three nearly identical starting conditions diverge over time."]),
      1,
    );
  });

  it("leaves arbitrary pages on the model-backed general path", () => {
    expect(seededArtifactsFor("https://example.com/article", sections(["A useful equation."]))).toBeNull();
  });
});
