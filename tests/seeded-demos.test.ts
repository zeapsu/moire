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
        "We call this Scaled Dot-Product Attention. The queries and keys are divided before softmax produces weights on the values.",
        "The queries, keys, and values are linearly projected in parallel and the outputs are concatenated for multi-head attention.",
        "Positional encodings use sine and cosine functions of different frequencies for relative or absolute position and order.",
      ]),
      3,
    );
  });

  it("provides three validated Kibble-Zurek artifacts for the selected physics paper", () => {
    expectValidSeed(
      "https://arxiv.org/abs/1811.05327",
      sections([
        "The number of domains follows a power law scaling in quench time.",
        "The freezing time is pivotal in KZM and identifies when evolution becomes non-adiabatic by equating the quench time scale to the relaxation time.",
        "The lower branch of the dispersion has one or two minima across the transition.",
      ]),
      3,
    );
  });

  it("provides a validated non-arXiv double-pendulum simulation", () => {
    expectValidSeed(
      "https://en.wikipedia.org/wiki/Double_pendulum",
      sections(["Three nearly identical initial conditions diverge over time."]),
      1,
    );
  });

  it("leaves arbitrary pages on the model-backed general path", () => {
    expect(seededArtifactsFor("https://example.com/article", sections(["A useful equation."]))).toBeNull();
  });
});
