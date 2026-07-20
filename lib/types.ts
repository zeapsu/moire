import { z } from "zod";

export const parameterSchema = z
  .object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    default: z.number(),
    min: z.number(),
    max: z.number(),
    unit: z.string(),
  })
  .strict();

export const briefSchema = z
  .object({
    span_id: z.string().regex(/^s-\d+$/),
    anchor: z
      .object({
        section: z.string(),
        element_type: z.enum(["equation", "figure", "paragraph", "sentence"]),
        dom_selector: z.string().regex(/^#p-\d+$/),
        text_excerpt: z.string().min(1),
      })
      .strict(),
    title: z.string().min(1),
    concept: z.string().min(1),
    viz_kind: z.enum(["simulation", "animated-diagram", "interactive-plot", "3d-scene"]),
    render: z.enum(["2d", "3d"]),
    governing_math: z.string(),
    parameters: z.array(parameterSchema).min(1).max(6),
    expected_behavior: z.string().min(1),
    score: z.number().min(0).max(1),
  })
  .strict();

export const briefBatchSchema = z
  .object({
    briefs: z.array(briefSchema).max(6),
  })
  .strict();

export type VisualizationBrief = z.infer<typeof briefSchema>;

export type ScanSection = {
  selector: `#p-${number}`;
  section: string;
  elementType: "equation" | "figure" | "paragraph" | "sentence";
  text: string;
};

export type IngestedDocument = {
  targetUrl: string;
  title: string;
  byline?: string;
  siteName: string;
  html: string;
  sections: ScanSection[];
};

export type ArtifactValidation = {
  ok: boolean;
  errors: string[];
  bytes: number;
};

export type ArtifactResult =
  | { ok: true; html: string; repairUsed: boolean }
  | { ok: false; error: string; repairUsed: boolean };
