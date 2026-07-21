import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArtifactFrame } from "@/components/artifact-frame";

const html = "<!doctype html><html><body><canvas></canvas><script>window.parent.postMessage({ready:true}, '*')</script></body></html>";

describe("artifact frame", () => {
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
