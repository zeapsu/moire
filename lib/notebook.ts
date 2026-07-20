import { z } from "zod";
import {
  briefSchema,
  type ArtifactDescriptor,
  type ArtifactKind,
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

const notebookSchema = z.array(notebookEntrySchema).max(MAX_NOTEBOOK_ENTRIES);

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
    const parsed = notebookSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
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
