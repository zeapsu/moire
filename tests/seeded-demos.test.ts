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

  it("provides the validated Three.js Gaussian Splatting artifact without a model call", () => {
    const source = sections([
      "An important algorithmic choice in our method is the optimization of the full covariance matrix for the 3D Gaussians. To demonstrate the effect of this choice, we perform an ablation where we remove anisotropy by optimizing a single scalar value that controls the radius of the 3D Gaussian on all three axes. We observe that the anisotropy significantly improves the quality of the 3D Gaussians' ability to align with surfaces, which in turn allows for much higher rendering quality while maintaining the same number of points.",
    ]);
    expectValidSeed("https://arxiv.org/abs/2308.04079", source, 1);
    const seeded = seededArtifactsFor("https://arxiv.org/abs/2308.04079", source);
    expect(seeded?.[0].brief).toMatchObject({ viz_kind: "3d-scene", render: "3d" });
    expect(seeded?.[0].html).toContain("three@0.181.2");
    expect(seeded?.[0].html).toContain("@media (max-width: 560px)");
    expect(seeded?.[0].html).toContain("@media (max-width: 520px)");
    expect(seeded?.[0].html).not.toContain("@media (max-width: 820px)");
    expect(seeded?.[0].html).not.toContain("data-moire-runtime-bridge");
  });

  it("leaves arbitrary pages on the model-backed general path", () => {
    expect(seededArtifactsFor("https://example.com/article", sections(["A useful equation."]))).toBeNull();
  });
});
