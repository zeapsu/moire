import { describe, expect, it } from "vitest";
import {
  addNotebookEntry,
  notebookSelectionSection,
  notebookStorageKey,
  parseNotebook,
  resolveNotebookArtifact,
  type NotebookEntry,
} from "@/lib/notebook";

const entry: NotebookEntry = {
  artifactId: "9ba8fd67-b0bb-445d-8a8e-803f2fb38079",
  kind: "page",
  savedAt: 123,
  brief: {
    span_id: "s-1",
    anchor: { section: "Paper", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A passage" },
    title: "Notebook test",
    concept: "Persistence",
    viz_kind: "interactive-plot",
    render: "2d",
    governing_math: "x",
    grounding_terms: ["passage"],
    references: [],
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

  it("keeps valid saved experiments when one stored entry is corrupted", () => {
    const corrupted = { ...entry, artifactId: "not-a-uuid" };
    expect(parseNotebook(JSON.stringify([entry, corrupted, { ...entry, savedAt: 456 }]))).toEqual([
      entry,
      { ...entry, savedAt: 456 },
    ]);
  });

  it("deduplicates entries and keeps the newest first", () => {
    const updated = addNotebookEntry([entry], { ...entry, savedAt: 456 });
    expect(updated).toHaveLength(1);
    expect(updated[0].savedAt).toBe(456);
    expect(parseNotebook(JSON.stringify(updated))).toEqual(updated);
  });

  it("restores legacy entries as page artifacts", () => {
    const { kind: _kind, ...legacyEntry } = entry;
    expect(parseNotebook(JSON.stringify([legacyEntry]))[0].kind).toBe("page");
  });

  it("never falls back from a selected range to the page artifact on the same anchor", () => {
    const pageArtifact = {
      artifactId: "b3e7176c-d1cd-412f-9204-5e419ab3b24a",
      kind: "page" as const,
      status: "ready" as const,
      brief: entry.brief,
    };
    const selectionEntry: NotebookEntry = {
      ...entry,
      artifactId: "ce5ee601-ff55-4fb6-a15e-7a8e77a47c88",
      kind: "selection",
    };

    expect(resolveNotebookArtifact(selectionEntry, [pageArtifact])).toMatchObject({
      artifactId: selectionEntry.artifactId,
      kind: "selection",
      status: "idle",
    });
    expect(resolveNotebookArtifact(entry, [pageArtifact])).toBe(pageArtifact);
    expect(notebookSelectionSection(selectionEntry)).toEqual({
      selector: "#p-1",
      section: "Paper",
      elementType: "paragraph",
      text: "A passage",
    });
  });
});
