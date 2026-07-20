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

export const repairStageSchema = z.enum(["validation", "runtime"]);

export const repairStateSchema = z
  .object({
    attempts: z
      .object({
        validation: z.union([z.literal(0), z.literal(1)]),
        runtime: z.union([z.literal(0), z.literal(1)]),
      })
      .strict(),
    lastFailure: z
      .object({
        stage: repairStageSchema,
        message: z.string().min(1).max(2000),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type RepairStage = z.infer<typeof repairStageSchema>;
export type RepairState = z.infer<typeof repairStateSchema>;

export function emptyRepairState(): RepairState {
  return { attempts: { validation: 0, runtime: 0 }, lastFailure: null };
}

export type ArtifactResult =
  | { ok: true; html: string; repairState: RepairState }
  | { ok: false; error: string; repairState: RepairState };

export type ArtifactStatus = "idle" | "generating" | "ready" | "repairing" | "error";

export type ArtifactDescriptor = {
  artifactId: string;
  status: ArtifactStatus;
  brief: VisualizationBrief;
};

export type CachedArtifactResult = ArtifactResult & {
  artifactId: string;
  cached: boolean;
};
