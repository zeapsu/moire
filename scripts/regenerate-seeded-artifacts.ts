import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOpenAI } from "@/lib/openai";
import { generatorInstructions, validateArtifact, withArtifactCsp } from "@/lib/artifact";
import { ingestTarget } from "@/lib/ingest";
import { seededArtifactsFor } from "@/lib/seeded-demos";
import type { VisualizationBrief } from "@/lib/types";

const MODEL = "gpt-5.6-sol";
const REASONING_EFFORT = "high" as const;
const MAX_ARTIFACT_BYTES = 200 * 1024;
const MAX_CONCURRENCY = 2;
const TARGETS = [
  "https://arxiv.org/abs/1706.03762",
  "https://arxiv.org/abs/1811.05327",
  "https://en.wikipedia.org/wiki/Double_pendulum",
  "https://arxiv.org/abs/2308.04079",
] as const;

type CallMetric = {
  phase: "initial" | "validation-repair";
  latencyMs: number;
  inputTokens: number;
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

function outputDirectory(): string {
  const supplied = process.argv[2];
  if (!supplied || !path.isAbsolute(supplied)) {
    throw new Error("Pass an absolute temporary output directory as the first argument.");
  }
  return supplied;
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
): Promise<{ html: string; metric: CallMetric }> {
  const startedAt = performance.now();
  const response = await getOpenAI().responses.create({
    model: MODEL,
    reasoning: { effort: REASONING_EFFORT },
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
      outputTokens: usage?.output_tokens ?? 0,
      reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
  };
}

async function generateOne(
  targetUrl: string,
  brief: VisualizationBrief,
): Promise<{ html: string; metric: ArtifactMetric }> {
  console.log(`[start] ${brief.title}`);
  const calls: CallMetric[] = [];
  const initial = await callModel(generatorInstructions(brief), "initial");
  calls.push(initial.metric);
  let html = initial.html;
  let errors = validationErrors(brief, html);
  if (errors.length > 0) {
    console.log(`[repair] ${brief.title}: ${errors.join(" | ")}`);
    const repaired = await callModel(
      `${generatorInstructions(brief)}\n\nThe prior attempt below failed server-side contract validation. Repair it and return a full replacement HTML file.\nValidation diagnostics:\n- ${errors.join("\n- ")}\n<invalid_artifact>\n${html}\n</invalid_artifact>`,
      "validation-repair",
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
  const destination = outputDirectory();
  await mkdir(destination, { recursive: true });
  const tasks: Array<{ targetUrl: string; brief: VisualizationBrief }> = [];
  for (const targetUrl of TARGETS) {
    console.log(`[ingest] ${targetUrl}`);
    const document = await ingestTarget(targetUrl);
    const artifacts = seededArtifactsFor(targetUrl, document.sections);
    if (!artifacts) throw new Error(`No curated artifacts matched ${targetUrl}.`);
    tasks.push(...artifacts.map(({ brief }) => ({ targetUrl, brief })));
  }
  if (tasks.length !== 8) throw new Error(`Expected 8 curated artifacts, found ${tasks.length}.`);

  const htmlByTitle: Record<string, string> = {};
  const metrics: ArtifactMetric[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const generated = await generateOne(task.targetUrl, task.brief);
      htmlByTitle[task.brief.title] = generated.html;
      metrics.push(generated.metric);
      await writeFile(
        path.join(destination, `${safeFilename(task.brief.title)}.html`),
        `${generated.html}\n`,
        "utf8",
      );
    }
  }
  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));
  metrics.sort((a, b) => tasks.findIndex((task) => task.brief.title === a.title) - tasks.findIndex((task) => task.brief.title === b.title));
  const orderedHtml = Object.fromEntries(tasks.map((task) => [task.brief.title, htmlByTitle[task.brief.title]]));
  await writeFile(path.join(destination, "seeded-artifacts.json"), `${JSON.stringify(orderedHtml, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(destination, "metrics.json"),
    `${JSON.stringify({ model: MODEL, reasoningEffort: REASONING_EFFORT, generatedAt: new Date().toISOString(), artifacts: metrics }, null, 2)}\n`,
    "utf8",
  );
  console.log(`[complete] ${tasks.length} artifacts written to ${destination}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
