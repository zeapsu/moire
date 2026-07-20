import { describe, expect, it } from "vitest";
import { addNotebookEntry, notebookStorageKey, parseNotebook, type NotebookEntry } from "@/lib/notebook";

const entry: NotebookEntry = {
  artifactId: "9ba8fd67-b0bb-445d-8a8e-803f2fb38079",
  savedAt: 123,
  brief: {
    span_id: "s-1",
    anchor: { section: "Paper", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A passage" },
    title: "Notebook test",
    concept: "Persistence",
    viz_kind: "interactive-plot",
    render: "2d",
    governing_math: "x",
    parameters: [{ name: "Speed", symbol: "v", default: 1, min: 0, max: 2, unit: "m/s" }],
    expected_behavior: "The plot responds.",
    score: 0.9,
  },
};

describe("notebook persistence", () => {
  it("uses the normalized target URL as the storage namespace", () => {
    expect(notebookStorageKey("https://example.com/paper")).toBe("moire:notebook:v1:https://example.com/paper");
  });

  it("rejects malformed or authority-bearing local data", () => {
    expect(parseNotebook("not json")).toEqual([]);
    expect(parseNotebook(JSON.stringify([{ ...entry, repairState: { attempts: { runtime: 0 } } }]))).toEqual([]);
  });

  it("deduplicates entries and keeps the newest first", () => {
    const updated = addNotebookEntry([entry], { ...entry, savedAt: 456 });
    expect(updated).toHaveLength(1);
    expect(updated[0].savedAt).toBe(456);
    expect(parseNotebook(JSON.stringify(updated))).toEqual(updated);
  });
});
