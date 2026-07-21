import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArtifactFrame, normalizeArtifactHeight } from "@/components/artifact-frame";

const html = "<!doctype html><html><body><canvas></canvas><script>window.parent.postMessage({ready:true}, '*')</script></body></html>";

describe("artifact frame", () => {
  it("accepts finite intrinsic heights and clamps hostile or impractical values", () => {
    expect(normalizeArtifactHeight(640.2)).toBe(641);
    expect(normalizeArtifactHeight(20)).toBe(300);
    expect(normalizeArtifactHeight(50_000)).toBe(1_200);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "640", null]) {
      expect(normalizeArtifactHeight(value)).toBeNull();
    }
  });

  it("places cached HTML in the first iframe render and exposes it immediately", () => {
    const markup = renderToStaticMarkup(
      createElement(ArtifactFrame, {
        html,
        title: "Cached experiment",
        instant: true,
        onRuntimeFailure: vi.fn(),
      }),
    );

    expect(markup).toContain('class="is-ready"');
    expect(markup).toContain("&lt;!doctype html&gt;");
    expect(markup).not.toContain("Starting the experiment");
  });

  it("keeps the startup treatment for a newly generated artifact", () => {
    const markup = renderToStaticMarkup(
      createElement(ArtifactFrame, {
        html,
        title: "Fresh experiment",
        onRuntimeFailure: vi.fn(),
      }),
    );

    expect(markup).toContain("Starting the experiment");
    expect(markup).not.toContain('class="is-ready"');
  });
});
