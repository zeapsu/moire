import { describe, expect, it } from "vitest";
import { sanitizeAndIndex } from "@/lib/ingest";

describe("document sanitization and indexing", () => {
  it("strips executable content and creates stable candidate selectors", () => {
    const result = sanitizeAndIndex(
      `<article class="lab-rail"><h1 onclick="bad()" style="position:fixed">Dynamics</h1><script>bad()</script><p>Enough readable text to become a visualization candidate with a useful stable selector.</p><img src="/figure.png" srcset="/large.png 2x"><a href="javascript:bad()" ping="/track">bad</a></article>`,
      "https://example.com/paper",
    );

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("position:fixed");
    expect(result.html).not.toContain("srcset");
    expect(result.html).not.toContain("ping=");
    expect(result.html).not.toContain("class=");
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections.every((section) => /^#p-\d+$/.test(section.selector))).toBe(true);
    for (const section of result.sections) {
      expect(result.html).toContain(`id="${section.selector.slice(1)}"`);
    }
  });

  it("preserves MathML while classifying its block as an equation", () => {
    const result = sanitizeAndIndex(
      `<article><h1>Wave equation</h1><div class="ltx_equation"><math><mi>x</mi><mo>=</mo><mn>1</mn></math> describes a parameterized state in a longer explanatory block.</div></article>`,
      "https://ar5iv.labs.arxiv.org/html/0000.00000",
    );
    expect(result.html).toContain("<math>");
    expect(result.sections.some((section) => section.elementType === "equation")).toBe(true);
  });
});
