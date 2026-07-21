import { z } from "zod";
import {
  briefSchema,
  type ArtifactDescriptor,
  type ArtifactKind,
  type ScanSection,
  type VisualizationBrief,
} from "@/lib/types";

const MAX_NOTEBOOK_ENTRIES = 24;

const notebookEntrySchema = z
  .object({
    artifactId: z.string().uuid(),
    kind: z.enum(["page", "selection"]).default("page"),
    brief: briefSchema,
    savedAt: z.number().int().nonnegative(),
  })
  .strict();

export type NotebookEntry = {
  artifactId: string;
  kind: ArtifactKind;
  brief: VisualizationBrief;
  savedAt: number;
};

export function notebookStorageKey(targetUrl: string): string {
  return `moire:notebook:v1:${targetUrl}`;
}

export function parseNotebook(value: string | null): NotebookEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((candidate) => notebookEntrySchema.safeParse(candidate))
      .filter((candidate) => candidate.success)
      .map((candidate) => candidate.data)
      .slice(0, MAX_NOTEBOOK_ENTRIES);
  } catch {
    return [];
  }
}

export function notebookSelectionSection(entry: NotebookEntry): ScanSection | null {
  if (entry.kind !== "selection") return null;
  const selector = entry.brief.anchor.dom_selector;
  if (!/^#p-\d+$/.test(selector)) return null;
  return {
    selector: selector as ScanSection["selector"],
    section: entry.brief.anchor.section,
    elementType: entry.brief.anchor.element_type,
    text: entry.brief.anchor.text_excerpt,
  };
}

export function addNotebookEntry(entries: NotebookEntry[], entry: NotebookEntry): NotebookEntry[] {
  return [entry, ...entries.filter((candidate) => candidate.artifactId !== entry.artifactId)].slice(
    0,
    MAX_NOTEBOOK_ENTRIES,
  );
}

export function resolveNotebookArtifact(
  entry: NotebookEntry,
  artifacts: ArtifactDescriptor[],
): ArtifactDescriptor {
  const exact = artifacts.find((artifact) => artifact.artifactId === entry.artifactId);
  if (exact) return exact;

  if (entry.kind === "page") {
    const rescannedPage = artifacts.find(
      (artifact) =>
        artifact.kind === "page" &&
        artifact.brief.anchor.dom_selector === entry.brief.anchor.dom_selector,
    );
    if (rescannedPage) return rescannedPage;
  }

  return {
    artifactId: entry.artifactId,
    kind: entry.kind,
    brief: entry.brief,
    status: "idle",
  };
}
