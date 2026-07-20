import { JSDOM } from "jsdom";
import { getOpenAI } from "@/lib/openai";
import { emptyRepairState, type ArtifactResult, type ArtifactValidation, type RepairStage, type RepairState, type VisualizationBrief } from "@/lib/types";

export const THREE_JS_URL = "https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.js";
const MAX_ARTIFACT_BYTES = 200 * 1024;
const MAX_CONCURRENCY = 2;
const MAX_QUEUE_DEPTH = 20;

export class ArtifactQueueFullError extends Error {}

type QueueItem<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const queue: QueueItem<unknown>[] = [];
let active = 0;

function drainQueue(): void {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const item = queue.shift();
    if (!item) return;
    active += 1;
    item
      .task()
      .then(item.resolve, item.reject)
      .finally(() => {
        active -= 1;
        drainQueue();
      });
  }
}

export function runArtifactTask<T>(task: () => Promise<T>): Promise<T> {
  if (queue.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new ArtifactQueueFullError("The visualization queue is full. Try again shortly."));
  }
  return new Promise<T>((resolve, reject) => {
    queue.push({ task, resolve: resolve as (value: unknown) => void, reject });
    drainQueue();
  });
}

function validateImportMap(document: Document, errors: string[]): void {
  const importMaps = [...document.querySelectorAll('script[type="importmap"]')];
  if (importMaps.length !== 1) {
    errors.push("3D artifact must contain exactly one import map.");
    return;
  }
  try {
    const parsed = JSON.parse(importMaps[0].textContent ?? "") as { imports?: Record<string, string>; scopes?: unknown };
    if (parsed.scopes || !parsed.imports || Object.keys(parsed.imports).length !== 1 || parsed.imports.three !== THREE_JS_URL) {
      errors.push("3D artifact import map may contain only the pinned three.js mapping.");
    }
  } catch {
    errors.push("3D artifact import map is invalid JSON.");
  }
}

function validateNetworkSurfaces(document: Document, render: "2d" | "3d", errors: string[]): void {
  const urlAttributes = ["src", "href", "action", "formaction", "poster", "data", "xlink:href"];
  for (const element of document.querySelectorAll("*")) {
    for (const name of urlAttributes) {
      const value = element.getAttribute(name)?.trim();
      if (!value || value.startsWith("#") || value.startsWith("data:")) continue;
      if (render === "3d" && element.tagName === "SCRIPT" && value === THREE_JS_URL) continue;
      errors.push(`Artifact contains a network-capable ${name} attribute.`);
      return;
    }
  }

  const styleText = [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n");
  for (const match of styleText.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const value = match[2].trim();
    if (!value.startsWith("data:") && !value.startsWith("#")) {
      errors.push("Artifact CSS contains a network-capable URL.");
      break;
    }
  }
  if (/@import\b/i.test(styleText)) errors.push("Artifact CSS may not use @import.");
}

export function validateArtifact(html: string, render: "2d" | "3d", expectedParameters = 1): ArtifactValidation {
  const errors: string[] = [];
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_ARTIFACT_BYTES) errors.push(`Artifact is ${bytes} bytes; the limit is ${MAX_ARTIFACT_BYTES}.`);
  if (!/^\s*<!doctype html>/i.test(html)) errors.push("Artifact must begin with <!doctype html>.");

  const dom = new JSDOM(html);
  const { document } = dom.window;
  if (!document.documentElement || !document.head || !document.body) errors.push("Artifact is not a complete HTML document.");
  if (document.querySelectorAll("script").length === 0) errors.push("Artifact must include inline JavaScript.");
  const sliders = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')];
  if (sliders.length < expectedParameters) {
    errors.push(`Artifact has ${sliders.length} parameter sliders; expected at least ${expectedParameters}.`);
  }
  if (document.querySelector("iframe,object,embed,link,form,base,meta[http-equiv='refresh']")) {
    errors.push("Artifact contains a prohibited embedded or navigational element.");
  }
  const scriptText = [...document.querySelectorAll("script")].map((script) => script.textContent ?? "").join("\n");
  const hasReadyPayload = /(?:["']ready["']|\bready)\s*:\s*true\b/i.test(scriptText);
  if (!/\bpostMessage\s*\(/i.test(scriptText) || !hasReadyPayload) {
    errors.push("Artifact must postMessage({ready:true}) after initialization.");
  }
  if (!/what\s+you(?:'|’|&#39;)re\s+seeing/i.test(document.body.textContent ?? "")) {
    errors.push("Artifact must include a What you're seeing caption.");
  }
  const sliderIds = sliders.map((slider) => slider.id).filter(Boolean);
  if (sliderIds.length !== sliders.length || new Set(sliderIds).size !== sliderIds.length) {
    errors.push("Every parameter slider must have a unique id.");
  } else if (sliderIds.some((id) => !scriptText.includes(id))) {
    errors.push("Every parameter slider id must be referenced by the artifact JavaScript.");
  }
  if (sliders.length > 0 && !/addEventListener\s*\(\s*["']input["']|\.oninput\s*=/i.test(scriptText)) {
    errors.push("Parameter sliders must bind an input event handler.");
  }

  const prohibitedNetworkApis = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker|SharedWorker|import)\s*\(/i;
  if (prohibitedNetworkApis.test(scriptText)) errors.push("Artifact uses a prohibited network API.");
  const isSafeAssignedUrl = (expression: string) => /^["'`](?:data:|blob:|#)/i.test(expression.trim());
  const propertyAssignments = [...scriptText.matchAll(/\.(?:src|href)\s*=\s*([^;\n]+)/gi)].map((match) => match[1]);
  const attributeAssignments = [
    ...scriptText.matchAll(/setAttribute\s*\(\s*["'](?:src|href)["']\s*,\s*([^,)]+)/gi),
  ].map((match) => match[1]);
  if ([...propertyAssignments, ...attributeAssignments].some((expression) => !isSafeAssignedUrl(expression))) {
    errors.push("Artifact JavaScript may not assign network-capable element URLs.");
  }
  const explicitNavigation =
    /\b(?:window|globalThis|self|top|parent|document)\.location(?:\.href)?\s*=|\b(?:window|globalThis|self|top|parent|document)\.location\.(?:assign|replace)\s*\(|\b(?:window|globalThis|self|top|parent)\.open\s*\(/i.test(
      scriptText,
    );
  const declaresLocalLocation =
    /\b(?:let|const|var|class|function)\s+location\b|(?:\(|,)\s*location\s*(?:[,)=])/i.test(scriptText);
  const bareLocationNavigation =
    /(?<![.\w$])location(?:\.href)?\s*=|(?<![.\w$])location\.(?:assign|replace)\s*\(/i.test(scriptText);
  if (explicitNavigation || (bareLocationNavigation && !declaresLocalLocation)) {
    errors.push("Artifact attempts navigation.");
  }
  const literalUrls = [...scriptText.matchAll(/["'`]((?:https?:)?\/\/[^\s"'`<>\\)]+)["'`]/gi)].map((match) =>
    match[1].replace(/[;,]+$/, ""),
  );
  if (literalUrls.some((url) => url !== THREE_JS_URL)) errors.push("Artifact contains a non-allowlisted URL literal.");
  validateNetworkSurfaces(document, render, errors);
  if (render === "2d" && document.querySelector('script[type="importmap"]')) {
    errors.push("2D artifacts may not include an import map.");
  }
  if (render === "3d") {
    validateImportMap(document, errors);
    for (const script of document.querySelectorAll('script[type="module"]')) {
      const imports = [...(script.textContent ?? "").matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
      if (imports.some((specifier) => specifier !== "three")) errors.push("3D artifact may import only the three module specifier.");
    }
  } else if ([...document.querySelectorAll('script[type="module"]')].some((script) => /\bimport\b/.test(script.textContent ?? ""))) {
    errors.push("2D artifacts may not import modules.");
  }

  return { ok: errors.length === 0, errors, bytes };
}

function generatorInstructions(brief: VisualizationBrief): string {
  const networkRule =
    brief.render === "3d"
      ? `Use a static import map mapping \"three\" to exactly ${THREE_JS_URL}. This is the only permitted external URL.`
      : "Use canvas or SVG with vanilla JavaScript. Include no external URLs or imports.";
  return [
    "Return exactly one complete self-contained HTML file beginning with <!doctype html>. Do not use Markdown fences or commentary.",
    "Use inline CSS and JavaScript. Make the visualization responsive, accessible, and legible on a dark canvas.",
    "Create a labeled input[type=range] with a unique id for every supplied parameter. Reference every id in JavaScript and bind an input event listener to visible behavior.",
    "Include a concise paragraph labeled 'What you're seeing' that explains the behavior in plain language.",
    networkRule,
    "Do not use fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, forms, cookies, storage, or navigation.",
    "After successful initialization, call window.parent.postMessage({ready:true}, '*').",
    `Visualization brief: ${JSON.stringify(brief)}`,
  ].join("\n");
}

async function callGenerator(instructions: string): Promise<string> {
  const response = await getOpenAI().responses.create({
    model: "gpt-5.6",
    reasoning: { effort: "high" },
    max_output_tokens: 20_000,
    input: instructions,
  });
  return response.output_text.trim();
}

async function repairOnce(
  brief: VisualizationBrief,
  invalidHtml: string,
  stage: RepairStage,
  errors: string[],
): Promise<string> {
  const prior = new JSDOM(invalidHtml);
  prior.window.document.querySelectorAll("meta[data-moire-csp]").forEach((meta) => meta.remove());
  const failureContext = stage === "validation" ? "server-side contract validation" : "browser execution";
  return callGenerator(
    `${generatorInstructions(brief)}\n\nThe prior attempt below failed ${failureContext}. Repair it and return a full replacement HTML file.\n${stage === "validation" ? "Validation" : "Runtime"} diagnostics:\n- ${errors.join("\n- ")}\n<invalid_artifact>\n${prior.serialize()}\n</invalid_artifact>`,
  );
}

export function withArtifactCsp(html: string, render: "2d" | "3d"): string {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  document
    .querySelectorAll("meta[http-equiv]")
    .forEach((meta) => meta.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy" && meta.remove());
  const csp = document.createElement("meta");
  csp.setAttribute("data-moire-csp", "");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute(
    "content",
    `default-src 'none'; script-src 'unsafe-inline'${render === "3d" ? " https://cdn.jsdelivr.net" : ""}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
  );
  document.head.prepend(csp);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function recordFailure(state: RepairState, stage: RepairStage, message: string): RepairState {
  return { ...state, lastFailure: { stage, message: message.slice(0, 2000) } };
}

function validateForDelivery(
  html: string,
  render: "2d" | "3d",
  expectedParameters: number,
): ArtifactValidation {
  const validation = validateArtifact(html, render, expectedParameters);
  if (!validation.ok) return validation;
  const securedBytes = Buffer.byteLength(withArtifactCsp(html, render), "utf8");
  return securedBytes <= MAX_ARTIFACT_BYTES
    ? validation
    : {
        ok: false,
        errors: [`Artifact is ${securedBytes} bytes after security policy injection; the limit is ${MAX_ARTIFACT_BYTES}.`],
        bytes: securedBytes,
      };
}

function successfulArtifact(html: string, render: "2d" | "3d", repairState: RepairState): ArtifactResult {
  const secured = withArtifactCsp(html, render);
  if (Buffer.byteLength(secured, "utf8") > MAX_ARTIFACT_BYTES) {
    return {
      ok: false,
      error: "The visualization exceeded 200KB after security policy injection.",
      repairState: recordFailure(repairState, "validation", "Artifact exceeded 200KB after security policy injection."),
    };
  }
  return { ok: true, html: secured, repairState };
}

export async function generateArtifact(brief: VisualizationBrief): Promise<ArtifactResult> {
  return runArtifactTask(async () => {
    const initialState = emptyRepairState();
    const initial = await callGenerator(generatorInstructions(brief));
    const initialValidation = validateForDelivery(initial, brief.render, brief.parameters.length);
    if (initialValidation.ok) return successfulArtifact(initial, brief.render, initialState);

    const validationRepairState: RepairState = {
      attempts: { validation: 1, runtime: 0 },
      lastFailure: { stage: "validation", message: initialValidation.errors.join(" ").slice(0, 2000) },
    };
    const repaired = await repairOnce(brief, initial, "validation", initialValidation.errors);
    const repairedValidation = validateForDelivery(repaired, brief.render, brief.parameters.length);
    if (repairedValidation.ok) return successfulArtifact(repaired, brief.render, validationRepairState);
    const terminalState = recordFailure(validationRepairState, "validation", repairedValidation.errors.join(" "));
    return {
      ok: false,
      error: `The visualization failed its safety checks after one repair: ${repairedValidation.errors.join(" ")}`,
      repairState: terminalState,
    };
  });
}

export async function repairRuntimeFailure(
  brief: VisualizationBrief,
  invalidHtml: string,
  runtimeError: string,
  priorState: RepairState,
): Promise<ArtifactResult> {
  const failureState = recordFailure(priorState, "runtime", runtimeError);
  if (priorState.attempts.runtime === 1) {
    return { ok: false, error: "The visualization could not start after its runtime repair.", repairState: failureState };
  }
  return runArtifactTask(async () => {
    const runtimeRepairState: RepairState = {
      attempts: { validation: priorState.attempts.validation, runtime: 1 },
      lastFailure: failureState.lastFailure,
    };
    const repaired = await repairOnce(brief, invalidHtml, "runtime", [runtimeError]);
    const validation = validateForDelivery(repaired, brief.render, brief.parameters.length);
    return validation.ok
      ? successfulArtifact(repaired, brief.render, runtimeRepairState)
      : {
          ok: false,
          error: `The visualization failed after its runtime repair: ${validation.errors.join(" ")}`,
          repairState: recordFailure(runtimeRepairState, "validation", validation.errors.join(" ")),
        };
  });
}
