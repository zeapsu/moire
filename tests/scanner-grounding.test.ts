import { describe, expect, it } from "vitest";
import { briefIsGroundedInSource } from "@/lib/scanner";
import { briefSchema, type ScanSection, type VisualizationBrief } from "@/lib/types";

const source: ScanSection = {
  selector: "#p-1",
  section: "Attention",
  elementType: "paragraph",
  text: "Queries and keys are divided before softmax produces weights on the values.",
};

const brief: VisualizationBrief = {
  span_id: "s-1",
  anchor: {
    section: source.section,
    element_type: source.elementType,
    dom_selector: source.selector,
    text_excerpt: source.text,
  },
  title: "Softmax weights",
  concept: "Queries and keys produce weights on the values.",
  viz_kind: "interactive-plot",
  render: "2d",
  governing_math: "softmax(QK^T)",
  grounding_terms: ["Queries", "keys", "weights on the values"],
  references: [],
  parameters: [{ name: "Query", symbol: "Q", default: 1, min: 0, max: 2, unit: "" }],
  expected_behavior: "The weights change.",
  score: 0.9,
};

describe("visualization brief grounding", () => {
  it("accepts exact source terminology with normalized case and whitespace", () => {
    expect(briefIsGroundedInSource(brief, source)).toBe(true);
  });

  it("rejects an invented grounding term", () => {
    expect(briefIsGroundedInSource({ ...brief, grounding_terms: ["temperature"] }, source)).toBe(false);
  });

  it("rejects a reference URL that was not present in model input", () => {
    expect(
      briefIsGroundedInSource(
        {
          ...brief,
          references: [{ term: "temperature", label: "Definition", url: "https://example.com/temperature" }],
        },
        source,
      ),
    ).toBe(false);
  });

  it("migrates legacy stored briefs while leaving them ineligible as new scan output", () => {
    const { grounding_terms: _terms, references: _references, ...legacy } = brief;
    const migrated = briefSchema.parse(legacy);
    expect(migrated.grounding_terms).toEqual([]);
    expect(migrated.references).toEqual([]);
    expect(briefIsGroundedInSource(migrated, source)).toBe(false);
  });

  it("only accepts HTTP(S) reference links", () => {
    expect(
      briefSchema.safeParse({
        ...brief,
        references: [{ term: "unsafe", label: "Unsafe", url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
  });
});
