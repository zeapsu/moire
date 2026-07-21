import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getModelGateway } from "@/lib/model-gateway";
import { generatorInstructions, validateArtifact, withArtifactCsp } from "@/lib/artifact";
import { ingestTarget } from "@/lib/ingest";
import { seededArtifactsFor } from "@/lib/seeded-demos";
import type { VisualizationBrief } from "@/lib/types";

const DEFAULT_MODEL = "openai/gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "high" as const;
const MAX_ARTIFACT_BYTES = 200 * 1024;
const DEFAULT_MAX_CONCURRENCY = 2;
const ALLOWED_MODELS = [
  "x-ai/grok-4.5",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
] as const;
const ALLOWED_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const TARGETS = [
  "https://arxiv.org/abs/1706.03762",
  "https://arxiv.org/abs/1811.05327",
  "https://en.wikipedia.org/wiki/Double_pendulum",
  "https://arxiv.org/abs/2308.04079",
] as const;
const REPACK_ARTIFACTS = [
  ["Inside scaled dot-product attention", "inside-scaled-dot-product-attention.html"],
  ["Multi-head attention in parallel", "multi-head-attention-in-parallel.html"],
  ["Sine and cosine positional encodings", "sine-and-cosine-positional-encodings.html"],
  ["Number of domains and quench time", "number-of-domains-and-quench-time.html"],
  ["Freezing time and non-adiabatic evolution", "freezing-time-and-non-adiabatic-evolution.html"],
  ["Lower branch with one or two minima", "lower-branch-with-one-or-two-minima.html"],
  ["Nearly identical initial conditions diverge", "pendulum-runtime-repaired.html"],
  ["Anisotropy: 3D Gaussians align with surfaces", "anisotropy-3d-gaussians-align-with-surfaces.html"],
] as const;

type CallMetric = {
  phase: "initial" | "validation-repair";
  latencyMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type ArtifactMetric = {
  targetUrl: string;
  title: string;
  render: VisualizationBrief["render"];
  calls: CallMetric[];
  bytes: number;
};

type BenchmarkModel = (typeof ALLOWED_MODELS)[number];
type ReasoningEffort = (typeof ALLOWED_REASONING_EFFORTS)[number];

type GenerationOptions = {
  destination: string;
  model: BenchmarkModel;
  reasoningEffort: ReasoningEffort;
  titles: Set<string>;
  maxConcurrency: number;
};

function generationOptions(): GenerationOptions {
  const supplied = process.argv[2];
  if (!supplied || !path.isAbsolute(supplied)) {
    throw new Error("Pass an absolute temporary output directory as the first argument.");
  }
  const relativeToRepository = path.relative(process.cwd(), supplied);
  if (relativeToRepository === "" || (!relativeToRepository.startsWith("..") && !path.isAbsolute(relativeToRepository))) {
    throw new Error("Generation output must be outside the repository so it cannot overwrite seeded demo artifacts.");
  }

  let model: BenchmarkModel = DEFAULT_MODEL;
  let reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT;
  let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  const titles = new Set<string>();
  const args = process.argv.slice(3);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--model") {
      if (!ALLOWED_MODELS.includes(value as BenchmarkModel)) {
        throw new Error(`Unsupported model ${value}. Choose one of: ${ALLOWED_MODELS.join(", ")}.`);
      }
      model = value as BenchmarkModel;
    } else if (flag === "--effort") {
      if (!ALLOWED_REASONING_EFFORTS.includes(value as ReasoningEffort)) {
        throw new Error(`Unsupported reasoning effort ${value}. Choose one of: ${ALLOWED_REASONING_EFFORTS.join(", ")}.`);
      }
      reasoningEffort = value as ReasoningEffort;
    } else if (flag === "--title") {
      titles.add(value);
    } else if (flag === "--concurrency") {
      maxConcurrency = Number(value);
      if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > DEFAULT_MAX_CONCURRENCY) {
        throw new Error(`Concurrency must be an integer from 1 to ${DEFAULT_MAX_CONCURRENCY}.`);
      }
    } else {
      throw new Error(`Unknown option ${flag}.`);
    }
    index += 1;
  }
  return { destination: supplied, model, reasoningEffort, titles, maxConcurrency };
}

async function repackExisting(): Promise<void> {
  const sourceDirectory = process.argv[3];
  const destinationFile = process.argv[4];
  if (!sourceDirectory || !path.isAbsolute(sourceDirectory) || !destinationFile || !path.isAbsolute(destinationFile)) {
    throw new Error("Usage: regenerate-seeded-artifacts.ts --repack /absolute/source-directory /absolute/seeded-artifacts.json");
  }

  const artifacts = Object.fromEntries(
    await Promise.all(
      REPACK_ARTIFACTS.map(async ([title, filename]) => {
        const html = (await readFile(path.join(sourceDirectory, filename), "utf8")).trim();
        const render = title === "Anisotropy: 3D Gaussians align with surfaces" ? "3d" : "2d";
        const validation = validateArtifact(html, render);
        if (!validation.ok) throw new Error(`${title} failed repack validation: ${validation.errors.join(" ")}`);
        return [title, html] as const;
      }),
    ),
  );
  await writeFile(destinationFile, `${JSON.stringify(artifacts, null, 2)}\n`, "utf8");
  console.log(`[repacked] ${REPACK_ARTIFACTS.length} artifacts written to ${destinationFile}`);
}

function safeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function validationErrors(brief: VisualizationBrief, html: string): string[] {
  const validation = validateArtifact(html, brief.render, brief.parameters.length);
  if (!validation.ok) return validation.errors;
  const securedBytes = Buffer.byteLength(withArtifactCsp(html, brief.render), "utf8");
  return securedBytes <= MAX_ARTIFACT_BYTES
    ? []
    : [`Artifact is ${securedBytes} bytes after security policy injection; the limit is ${MAX_ARTIFACT_BYTES}.`];
}

async function callModel(
  input: string,
  phase: CallMetric["phase"],
  options: Pick<GenerationOptions, "model" | "reasoningEffort">,
): Promise<{ html: string; metric: CallMetric }> {
  const startedAt = performance.now();
  const response = await getModelGateway().responses.create({
    model: options.model,
    reasoning: { effort: options.reasoningEffort },
    max_output_tokens: 20_000,
    input,
  });
  const usage = response.usage;
  return {
    html: response.output_text.trim(),
    metric: {
      phase,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: usage?.input_tokens ?? 0,
      cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
  };
}

async function generateOne(
  targetUrl: string,
  brief: VisualizationBrief,
  options: Pick<GenerationOptions, "model" | "reasoningEffort">,
): Promise<{ html: string; metric: ArtifactMetric }> {
  console.log(`[start] ${brief.title}`);
  const calls: CallMetric[] = [];
  const initial = await callModel(generatorInstructions(brief), "initial", options);
  calls.push(initial.metric);
  let html = initial.html;
  let errors = validationErrors(brief, html);
  if (errors.length > 0) {
    console.log(`[repair] ${brief.title}: ${errors.join(" | ")}`);
    const repaired = await callModel(
      `${generatorInstructions(brief)}\n\nThe prior attempt below failed server-side contract validation. Repair it and return a full replacement HTML file.\nValidation diagnostics:\n- ${errors.join("\n- ")}\n<invalid_artifact>\n${html}\n</invalid_artifact>`,
      "validation-repair",
      options,
    );
    calls.push(repaired.metric);
    html = repaired.html;
    errors = validationErrors(brief, html);
  }
  if (errors.length > 0) {
    throw new Error(`${brief.title} failed validation after one repair: ${errors.join(" ")}`);
  }
  const metric: ArtifactMetric = {
    targetUrl,
    title: brief.title,
    render: brief.render,
    calls,
    bytes: Buffer.byteLength(html, "utf8"),
  };
  console.log(
    `[ready] ${brief.title} calls=${calls.length} latencyMs=${calls.reduce((sum, call) => sum + call.latencyMs, 0)} tokens=${calls.reduce((sum, call) => sum + call.totalTokens, 0)}`,
  );
  return { html, metric };
}

async function main(): Promise<void> {
  const options = generationOptions();
  const { destination } = options;
  await mkdir(destination, { recursive: true });
  const tasks: Array<{ targetUrl: string; brief: VisualizationBrief }> = [];
  for (const targetUrl of TARGETS) {
    console.log(`[ingest] ${targetUrl}`);
    const document = await ingestTarget(targetUrl);
    const artifacts = seededArtifactsFor(targetUrl, document.sections);
    if (!artifacts) throw new Error(`No curated artifacts matched ${targetUrl}.`);
    tasks.push(
      ...artifacts
        .filter(({ brief }) => options.titles.size === 0 || options.titles.has(brief.title))
        .map(({ brief }) => ({ targetUrl, brief })),
    );
  }
  if (options.titles.size > 0) {
    const matchedTitles = new Set(tasks.map((task) => task.brief.title));
    const missingTitles = [...options.titles].filter((title) => !matchedTitles.has(title));
    if (missingTitles.length > 0) throw new Error(`Unknown seeded artifact title(s): ${missingTitles.join(", ")}.`);
  } else if (tasks.length !== REPACK_ARTIFACTS.length) {
    throw new Error(`Expected ${REPACK_ARTIFACTS.length} curated artifacts, found ${tasks.length}.`);
  }
  if (tasks.length === 0) throw new Error("No seeded artifacts selected for generation.");

  const htmlByTitle: Record<string, string> = {};
  const metrics: ArtifactMetric[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const generated = await generateOne(task.targetUrl, task.brief, options);
      htmlByTitle[task.brief.title] = generated.html;
      metrics.push(generated.metric);
      await writeFile(
        path.join(destination, `${safeFilename(task.brief.title)}.html`),
        `${generated.html}\n`,
        "utf8",
      );
    }
  }
  await Promise.all(Array.from({ length: options.maxConcurrency }, () => worker()));
  metrics.sort((a, b) => tasks.findIndex((task) => task.brief.title === a.title) - tasks.findIndex((task) => task.brief.title === b.title));
  const orderedHtml = Object.fromEntries(tasks.map((task) => [task.brief.title, htmlByTitle[task.brief.title]]));
  await writeFile(path.join(destination, "seeded-artifacts.json"), `${JSON.stringify(orderedHtml, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(destination, "metrics.json"),
    `${JSON.stringify({ model: options.model, reasoningEffort: options.reasoningEffort, generatedAt: new Date().toISOString(), artifacts: metrics }, null, 2)}\n`,
    "utf8",
  );
  console.log(`[complete] ${tasks.length} artifacts written to ${destination}`);
}

const run = process.argv[2] === "--repack" ? repackExisting : main;
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
