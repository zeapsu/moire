import { z } from "zod";
import { briefSchema, type VisualizationBrief } from "@/lib/types";

const MAX_NOTEBOOK_ENTRIES = 24;

const notebookEntrySchema = z
  .object({
    artifactId: z.string().uuid(),
    brief: briefSchema,
    savedAt: z.number().int().nonnegative(),
  })
  .strict();

const notebookSchema = z.array(notebookEntrySchema).max(MAX_NOTEBOOK_ENTRIES);

export type NotebookEntry = {
  artifactId: string;
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
