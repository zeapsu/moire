import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { collectSelectionContext } from "@/lib/selection-context";
import { assessSelection } from "@/lib/selection-policy";
import type { ScanSection } from "@/lib/types";

const figureText =
  "Figure 10. We train scenes with Gaussian anisotropy disabled and enabled. Anisotropic volumetric splats model fine structures.";

function fixture() {
  const dom = new JSDOM(`<!doctype html><article id="paper">
    <section><h4 id="p-1">Anisotropic Covariance.</h4>
      <p id="p-2">The covariance matrix controls the radius on all three axes.</p>
      <figure id="p-3"><img alt="Refer to caption"><figcaption id="p-4">${figureText}</figcaption></figure>
    </section>
    <h2 id="p-5">Limitations</h2><p id="p-6">A separate concept appears here.</p>
  </article>`);
  const document = dom.window.document;
  const article = document.querySelector<HTMLElement>("#paper")!;
  const sections: ScanSection[] = [
    {
      selector: "#p-2",
      section: "Anisotropic Covariance.",
      elementType: "sentence",
      text: "The covariance matrix controls the radius on all three axes.",
    },
    { selector: "#p-3", section: "Anisotropic Covariance.", elementType: "figure", text: figureText },
    { selector: "#p-4", section: "Source", elementType: "figure", text: figureText },
    { selector: "#p-6", section: "Limitations", elementType: "sentence", text: "A separate concept appears here." },
  ];
  return { document, article, sections };
}

describe("selection context", () => {
  it("collapses a figure and nested caption into one grounded concept", () => {
    const { document, article, sections } = fixture();
    const caption = document.querySelector("#p-4")!;
    const range = document.createRange();
    range.selectNode(document.querySelector("#p-3")!);

    const result = collectSelectionContext(range, article, sections, caption.textContent ?? "");

    expect(result.source?.selector).toBe("#p-3");
    expect(result.context).toMatchObject({
      blockCount: 1,
      sectionCount: 1,
      headingCount: 0,
      elementTypes: ["figure"],
    });
    expect(assessSelection(result.text, result.context).status).toBe("eligible");
  });

  it("grounds an image-only selection in the source caption without inventing text", () => {
    const { document, article, sections } = fixture();
    const range = document.createRange();
    range.selectNode(document.querySelector("img")!);

    const result = collectSelectionContext(range, article, sections, "");

    expect(result.text).toBe(figureText);
    expect(result.source?.selector).toBe("#p-3");
    expect(assessSelection(result.text, result.context).status).toBe("eligible");
  });

  it("does not expand a one-character caption selection into the whole figure", () => {
    const { document, article, sections } = fixture();
    const text = document.querySelector("#p-4")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);

    const result = collectSelectionContext(range, article, sections, "F");

    expect(result.text).toBe("F");
    expect(assessSelection(result.text, result.context).status).toBe("too_narrow");
  });

  it("still rejects a selection spanning unrelated source sections", () => {
    const { document, article, sections } = fixture();
    const range = document.createRange();
    range.setStart(document.querySelector("#p-2")!.firstChild!, 0);
    range.setEnd(document.querySelector("#p-6")!.firstChild!, 25);

    const result = collectSelectionContext(range, article, sections, range.toString());

    expect(result.context.sectionCount).toBeGreaterThan(1);
    expect(assessSelection(result.text, result.context)).toMatchObject({ status: "too_broad", reason: "section-limit" });
  });

  it("clamps the client-computed document size to the scan schema maximum", () => {
    const { document, article, sections } = fixture();
    const range = document.createRange();
    range.selectNode(document.querySelector("#p-2")!);
    const oversizedSections = [
      ...sections,
      ...Array.from({ length: 2_779 }, (_, index) => ({
        selector: `#p-${index + 100}` as `#p-${number}`,
        section: "Large source",
        elementType: "paragraph" as const,
        text: "x".repeat(1_800),
      })),
    ];

    const result = collectSelectionContext(range, article, oversizedSections, range.toString());

    expect(result.context.documentCharacters).toBe(5_000_000);
  });
});
