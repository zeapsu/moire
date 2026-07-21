import { describe, expect, it } from "vitest";
import {
  assessSelection,
  selectionContextForStoredSection,
  type SelectionContext,
} from "@/lib/selection-policy";

const focusedContext: SelectionContext = {
  blockCount: 1,
  sectionCount: 1,
  headingCount: 0,
  documentCharacters: 10_000,
  elementTypes: ["paragraph"],
};

function assess(text: string, overrides: Partial<SelectionContext> = {}) {
  return assessSelection(text, { ...focusedContext, ...overrides });
}

describe("selection policy", () => {
  it.each([
    "Scaled Dot-Product Attention",
    "The attention weights determine how strongly each value contributes to the output.",
    "Transformers compare queries with keys before applying the resulting weights to values.",
    "La distribución cambia suavemente cuando aumenta la temperatura del sistema.",
    "The probability is 0.25, while the measured rate is 3.14 units per second.",
  ])("keeps a focused technical passage eligible: %s", (text) => {
    expect(assess(text).status).toBe("eligible");
  });

  it("keeps exact upper boundaries eligible", () => {
    const tenSentences = Array.from({ length: 10 }, (_, index) => `Sentence ${index + 1} explains one process.`).join(" ");
    const threeHundredWords = Array.from({ length: 300 }, () => "a").join(" ");
    const eighteenHundredCharacters = `${"a".repeat(899)} ${"b".repeat(900)}`;

    expect(assess(tenSentences).status).toBe("eligible");
    expect(assess(threeHundredWords).status).toBe("eligible");
    expect(assess(eighteenHundredCharacters).metrics.characters).toBe(1800);
    expect(assess(eighteenHundredCharacters).status).toBe("eligible");
    expect(assess("A complete relationship between two variables is described here.", { blockCount: 4 }).status).toBe(
      "eligible",
    );
    expect(assess("A complete relationship between two variables is described here.", { headingCount: 1 }).status).toBe(
      "eligible",
    );
  });

  it("accepts a compact self-contained equation but rejects isolated fragments", () => {
    expect(assess("E = mc²", { elementTypes: ["equation"] }).status).toBe("eligible");
    for (const text of ["", "   ", "x", "π", "softmax", "!!!", "🧪"]) {
      expect(assess(text).status, text).toBe("too_narrow");
    }
  });

  it.each([
    ["character-limit", `${"a".repeat(900)} ${"b".repeat(900)}`],
    ["word-limit", Array.from({ length: 301 }, () => "a").join(" ")],
    ["sentence-limit", Array.from({ length: 11 }, (_, index) => `Sentence ${index + 1} explains a process.`).join(" ")],
  ])("rejects content beyond the %s", (reason, text) => {
    expect(assess(text)).toMatchObject({ status: "too_broad", reason });
  });

  it.each([
    ["block-limit", { blockCount: 5 }],
    ["section-limit", { sectionCount: 2 }],
    ["heading-limit", { headingCount: 2 }],
  ] satisfies Array<[string, Partial<SelectionContext>]>)
  ("rejects structural over-selection at the %s", (reason, context) => {
    expect(assess("One focused relationship is described in this passage.", context)).toMatchObject({
      status: "too_broad",
      reason,
    });
  });

  it("rejects selections that cover a large share of the source", () => {
    expect(assess(`${"a".repeat(250)} ${"b".repeat(250)}`, { documentCharacters: 2_000 })).toMatchObject({
      status: "too_broad",
      reason: "document-scale",
    });
    expect(assess(`${"a".repeat(100)} ${"b".repeat(100)}`, { documentCharacters: 300 })).toMatchObject({
      status: "too_broad",
      reason: "document-scale",
    });
  });

  it("rejects every structural value beyond a hard boundary", () => {
    for (let blockCount = 5; blockCount <= 50; blockCount += 1) {
      expect(assess("One coherent process with enough supporting context.", { blockCount }).status).toBe("too_broad");
    }
    for (let sectionCount = 2; sectionCount <= 20; sectionCount += 1) {
      expect(assess("One coherent process with enough supporting context.", { sectionCount }).status).toBe("too_broad");
    }
  });

  it("does not mistake a persisted accepted selection for its whole document", () => {
    const section = {
      selector: "#p-1" as const,
      section: "Results",
      elementType: "paragraph" as const,
      text: "The measured response rises as the control parameter increases.",
    };
    const context = selectionContextForStoredSection(section);
    expect(context.documentCharacters).toBeGreaterThan(section.text.length);
    expect(assessSelection(section.text, context).status).toBe("eligible");
  });
});
