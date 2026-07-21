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

  it("retains only namespaced LaTeXML classes for arXiv layout parity", () => {
    const result = sanitizeAndIndex(
      `<article class="ltx_document hostile"><h1 class="ltx_title ltx_title_document app-shell">Paper</h1><div class="ltx_equation unsafe"><math><mi>x</mi></math> with enough explanatory text to scan.</div></article>`,
      "https://arxiv.org/html/0000.00000",
      { preserveLatexmlClasses: true },
    );
    expect(result.html).toContain('class="ltx_document"');
    expect(result.html).toContain('class="ltx_title ltx_title_document"');
    expect(result.html).toContain('class="ltx_equation"');
    expect(result.html).not.toContain("hostile");
    expect(result.html).not.toContain("app-shell");
    expect(result.html).not.toContain("unsafe");
  });

  it("wraps intrinsic-width LaTeXML tables in a local scroll container", () => {
    const result = sanitizeAndIndex(
      `<article class="ltx_document"><h1 class="ltx_title">Table paper</h1><table class="ltx_tabular"><tbody><tr><td>One</td><td>Two</td></tr></tbody></table><p class="ltx_p">A sufficiently long explanation follows the table for scanner indexing.</p></article>`,
      "https://arxiv.org/html/0000.00000",
      { preserveLatexmlClasses: true },
    );
    expect(result.html).toContain('class="ltx_table_scroll"');
    expect(result.html).toContain('class="ltx_tabular"');
  });

  it("removes noscript reparsing payloads before browser insertion", () => {
    const result = sanitizeAndIndex(
      `<article><h1>Unsafe source</h1><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript><p>This safe explanatory paragraph is long enough to become a visualization candidate.</p></article>`,
      "https://example.com/paper",
    );
    expect(result.html).not.toContain("<noscript");
    expect(result.html).not.toContain("onerror");
  });

  it("rewrites source fragment links to stable ids without opening a new tab", () => {
    const result = sanitizeAndIndex(
      `<article><h1 id="intro">Introduction</h1><p><a href="#intro">Return to introduction</a> with enough surrounding explanation to be useful.</p></article>`,
      "https://example.com/paper",
    );
    expect(result.html).toContain('href="#p-2"');
    expect(result.html).not.toContain('target="_blank"');
  });

  it("keeps absolute same-document references inside the Moiré reader", () => {
    const result = sanitizeAndIndex(
      `<article><h1 id="intro">Introduction</h1><p><a href="https://arxiv.org/html/2106.09685v2#intro">Return to introduction</a> with enough surrounding explanation to be useful. <a href="https://arxiv.org/html/2106.09685v2#inline-note">Read note</a>.</p><span id="inline-note">An inline note target.</span><a href="https://arxiv.org/html/other-paper#intro">Other paper</a></article>`,
      "https://arxiv.org/html/2106.09685",
      { preserveLatexmlClasses: true },
    );

    expect(result.html).toContain('href="#p-2">Return to introduction</a>');
    expect(result.html).toContain('href="#inline-note">Read note</a>');
    expect(result.html).toContain('href="https://arxiv.org/html/other-paper#intro"');
    expect(result.html).toContain('target="_blank"');
  });

  it("omits caption-less figures instead of producing an invalid empty scan section", () => {
    const result = sanitizeAndIndex(
      `<article><h1>Figures</h1><figure><img src="/plot.png"></figure><p>This valid paragraph remains available to the scanner after the empty figure.</p></article>`,
      "https://example.com/paper",
    );
    expect(result.sections.every((section) => section.text.length > 0)).toBe(true);
    expect(result.sections.some((section) => section.text.includes("valid paragraph"))).toBe(true);
  });
});
