import { JSDOM } from "jsdom";
import { getOpenAI } from "@/lib/openai";
import { emptyRepairState, type ArtifactResult, type ArtifactValidation, type RepairStage, type RepairState, type VisualizationBrief } from "@/lib/types";

export const THREE_JS_URL = "https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.js";
export const SVG_NAMESPACE_URL = "http://www.w3.org/2000/svg";
export const ARTIFACT_LAYOUT_VERSION = "1";
export const ARTIFACT_RUNTIME_BRIDGE_VERSION = "3";
export const ARTIFACT_LAYOUT_LIMITS = {
  narrowMaxWidth: 720,
  narrowStageRatio: 0.72,
  wideStageRatio: 0.58,
  minimumStageHeight: 300,
  overflowTolerance: 2,
} as const;
const MAX_ARTIFACT_BYTES = 200 * 1024;
const MAX_CONCURRENCY = 2;
const MAX_QUEUE_DEPTH = 20;

export type ArtifactPriority = "interactive" | "prefetch";

export class ArtifactQueueFullError extends Error {}

export function shouldUseStageFirstFallback(metrics: {
  viewportWidth: number;
  stageWidth: number;
  stageHeight: number;
  scrollWidth: number;
}): boolean {
  const minimumRatio =
    metrics.viewportWidth <= ARTIFACT_LAYOUT_LIMITS.narrowMaxWidth
      ? ARTIFACT_LAYOUT_LIMITS.narrowStageRatio
      : ARTIFACT_LAYOUT_LIMITS.wideStageRatio;
  return (
    metrics.stageWidth < metrics.viewportWidth * minimumRatio ||
    metrics.stageHeight < ARTIFACT_LAYOUT_LIMITS.minimumStageHeight ||
    metrics.scrollWidth > metrics.viewportWidth + ARTIFACT_LAYOUT_LIMITS.overflowTolerance
  );
}

type QueueItem<T> = {
  task: () => Promise<T>;
  priority: ArtifactPriority;
  key?: string;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const interactiveQueue: QueueItem<unknown>[] = [];
const prefetchQueue: QueueItem<unknown>[] = [];
let active = 0;

function drainQueue(): void {
  while (active < MAX_CONCURRENCY && interactiveQueue.length + prefetchQueue.length > 0) {
    const item = interactiveQueue.shift() ?? prefetchQueue.shift();
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

export function promoteArtifactTask(key: string): boolean {
  const index = prefetchQueue.findIndex((item) => item.key === key);
  if (index < 0) return false;
  const [item] = prefetchQueue.splice(index, 1);
  item.priority = "interactive";
  interactiveQueue.push(item);
  return true;
}

export function runArtifactTask<T>(
  task: () => Promise<T>,
  priority: ArtifactPriority = "interactive",
  key?: string,
): Promise<T> {
  if (interactiveQueue.length + prefetchQueue.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new ArtifactQueueFullError("The visualization queue is full. Try again shortly."));
  }
  return new Promise<T>((resolve, reject) => {
    const queue = priority === "interactive" ? interactiveQueue : prefetchQueue;
    queue.push({ task, priority, key, resolve: resolve as (value: unknown) => void, reject });
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

function validateLayoutContract(document: Document, sliders: HTMLInputElement[], errors: string[]): void {
  const layouts = [...document.querySelectorAll("[data-moire-layout]")];
  const stages = [...document.querySelectorAll("[data-moire-stage]")];
  const controls = [...document.querySelectorAll("[data-moire-controls]")];
  const captions = [...document.querySelectorAll("[data-moire-caption]")];
  const controlGroups = [...document.querySelectorAll("[data-moire-control]")];
  if (layouts.length !== 1) errors.push("Artifact must contain exactly one data-moire-layout root.");
  if (stages.length !== 1) errors.push("Artifact must contain exactly one data-moire-stage region.");
  if (controls.length !== 1) errors.push("Artifact must contain exactly one data-moire-controls region.");
  if (captions.length !== 1) errors.push("Artifact must contain exactly one data-moire-caption region.");
  const layout = layouts[0];
  if (layout && [...stages, ...controls, ...captions].some((region) => !layout.contains(region))) {
    errors.push("Every Moiré artifact region must be contained by data-moire-layout.");
  }
  const controlsRegion = controls[0];
  if (controlsRegion && sliders.some((slider) => !controlsRegion.contains(slider))) {
    errors.push("Every parameter slider must be inside data-moire-controls.");
  }
  if (sliders.some((slider) => !slider.closest("[data-moire-control]"))) {
    errors.push("Every parameter slider must be wrapped by data-moire-control.");
  }
  if (controlGroups.some((group) => !controlsRegion?.contains(group))) {
    errors.push("Every data-moire-control group must be inside data-moire-controls.");
  }
  const duplicateTitles = [...document.querySelectorAll("h1")].filter(
    (heading) => !heading.closest("[data-moire-chrome]"),
  );
  if (duplicateTitles.length > 0) errors.push("Artifact must not repeat the experiment title inside its content layout.");
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
  validateLayoutContract(document, sliders, errors);
  if (document.querySelector("iframe,object,embed,link,form,base,meta[http-equiv='refresh']")) {
    errors.push("Artifact contains a prohibited embedded or navigational element.");
  }
  const scriptUnits = [...document.querySelectorAll("script")].map((script) => script.textContent ?? "");
  const eventHandlerUnits = [...document.querySelectorAll("*")].flatMap((element) =>
    [...element.attributes].filter((attribute) => /^on/i.test(attribute.name)).map((attribute) => attribute.value),
  );
  const executableUnits = [...scriptUnits, ...eventHandlerUnits];
  const scriptText = scriptUnits.join("\n");
  const executableText = executableUnits.join("\n");
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
  if (sliders.length > 0 && !/addEventListener\s*\(\s*["']input["']|\.oninput\s*=|\boninput\s*=/i.test(executableText)) {
    errors.push("Parameter sliders must bind an input event handler.");
  }

  const prohibitedNetworkApis = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker|SharedWorker|import)\s*\(/i;
  if (prohibitedNetworkApis.test(executableText)) errors.push("Artifact uses a prohibited network API.");
  const isSafeAssignedUrl = (expression: string) => /^["'`](?:data:|blob:|#)/i.test(expression.trim());
  const propertyAssignments = [...executableText.matchAll(/\.(?:src|href)\s*=\s*([^;\n]+)/gi)].map((match) => match[1]);
  const attributeAssignments = [
    ...executableText.matchAll(/setAttribute\s*\(\s*["'](?:src|href)["']\s*,\s*([^,)]+)/gi),
  ].map((match) => match[1]);
  if ([...propertyAssignments, ...attributeAssignments].some((expression) => !isSafeAssignedUrl(expression))) {
    errors.push("Artifact JavaScript may not assign network-capable element URLs.");
  }
  const attemptsNavigation = (unit: string): boolean => {
    const explicitNavigation =
      /\b(?:window|globalThis|self|top|parent|document)\.location(?:\.href)?\s*=|\b(?:window|globalThis|self|top|parent|document)\.location\.(?:assign|replace)\s*\(|\b(?:window|globalThis|self|top|parent)\.open\s*\(/i.test(
        unit,
      );
    const declaresLocalLocation =
      /\b(?:let|const|var|class|function)\s+location\b/i.test(unit) ||
      /\bfunction(?:\s+[\w$]+)?\s*\([^)]*\blocation\b[^)]*\)/i.test(unit) ||
      /\([^)]*\blocation\b[^)]*\)\s*=>/i.test(unit) ||
      /(?<![.\w$])location\s*=>/i.test(unit);
    const bareLocationNavigation =
      /(?<![.\w$])location(?:\.href)?\s*=|(?<![.\w$])location\.(?:assign|replace)\s*\(/i.test(unit);

    return explicitNavigation || (bareLocationNavigation && !declaresLocalLocation);
  };
  if (executableUnits.some(attemptsNavigation)) {
    errors.push("Artifact attempts navigation.");
  }
  const literalUrls = [...executableText.matchAll(/["'`]((?:https?:)?\/\/[^\s"'`<>\\)]+)["'`]/gi)].map((match) =>
    match[1].replace(/[;,]+$/, ""),
  );
  if (literalUrls.some((url) => url !== THREE_JS_URL && url !== SVG_NAMESPACE_URL)) {
    errors.push("Artifact contains a non-allowlisted URL literal.");
  }
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

export function generatorInstructions(brief: VisualizationBrief): string {
  const networkRule =
    brief.render === "3d"
      ? [
          `Use exactly one static import map mapping \"three\" to ${THREE_JS_URL}, then import * as THREE from \"three\" in one inline type=\"module\" script. This is the only permitted external URL or module.`,
          "Build a real Three.js scene with THREE.Scene, PerspectiveCamera or OrthographicCamera, and WebGLRenderer. Use procedural geometry, materials, lights, and labels only; do not load models, textures, fonts, or other assets.",
          "Size the renderer from its visible container, cap device pixel ratio at 2, and update the camera and renderer with ResizeObserver or a resize listener.",
          "Use requestAnimationFrame only when motion explains the concept. Keep animation deterministic and bounded, and cancel it plus dispose geometries, materials, and the renderer on pagehide.",
          "If camera movement helps, implement pointer drag and wheel controls directly without importing OrbitControls. Keep the supplied sliders as the primary, labeled controls and make every slider visibly affect the scene.",
          "Render the first complete frame before posting the ready message. Keep the explanatory caption legible outside the WebGL canvas.",
        ].join(" ")
      : `Use canvas or static inline SVG with vanilla JavaScript. Include no external URLs or imports. If JavaScript creates SVG elements, ${SVG_NAMESPACE_URL} is the only permitted namespace URL literal.`;
  return [
    "Return exactly one complete self-contained HTML file beginning with <!doctype html>. Do not use Markdown fences or commentary.",
    "Use inline CSS and JavaScript. Make the visualization responsive, accessible, and legible on a dark canvas.",
    "You own the artifact's visual expression and may choose a distinctive composition, typography, palette, motion, labels, and spatial metaphor that fit the paper concept. Avoid a generic dashboard or repeated card-grid feel.",
    "Use exactly one data-moire-layout root containing exactly one data-moire-stage, one data-moire-controls, and one data-moire-caption region. Regions may be direct children or pass through a data-moire-support wrapper. Wrap every parameter control in data-moire-control. These attributes are semantic measurement hooks, not a prescribed visual style.",
    "Prioritize the data-moire-stage in the visual hierarchy. At frame widths up to 720px it must occupy at least 72% of the viewport width; at wider sizes it must occupy at least 58%. It must be at least 300px tall, remain fully visible without horizontal overflow, and respond cleanly from 320px through 1200px widths. If these hard limits fail, Moiré applies a stage-first fallback layout.",
    "The host already renders the experiment title. Begin the body directly with the data-moire-layout root: emit no h1 element, repeated title, header chrome, or page navigation. Keep controls visually subordinate and keep the What you're seeing explanation concise, ideally under 80 words. Do not use fixed page heights that clip content.",
    "Create a labeled input[type=range] with a unique id for every supplied parameter. Reference every id in JavaScript and bind an input event listener to visible behavior.",
    "Include a concise paragraph labeled 'What you're seeing' that explains the behavior in plain language.",
    "Use only technical terminology found in anchor.text_excerpt, grounding_terms, governing_math, and parameter symbols. Ordinary interface words are allowed, but do not coin technical labels, metaphors, or domain claims.",
    "The references array is the only exception for technical terminology not defined by the paper. Moiré renders those links outside this sandbox, so do not add links or external URLs to the artifact HTML.",
    networkRule,
    "Do not use fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, forms, cookies, storage, or navigation.",
    "After successful initialization, call window.parent.postMessage({ready:true}, '*').",
    `Visualization brief: ${JSON.stringify(brief)}`,
  ].join("\n");
}

async function callGenerator(instructions: string): Promise<string> {
  const response = await getOpenAI().responses.create({
    model: "gpt-5.6-sol",
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
  prior.window.document
    .querySelectorAll("meta[data-moire-csp],script[data-moire-runtime-bridge],style[data-moire-layout-contract]")
    .forEach((element) => element.remove());
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
  document.querySelectorAll("script[data-moire-runtime-bridge]").forEach((script) => script.remove());
  document.querySelectorAll("style[data-moire-layout-contract]").forEach((style) => style.remove());
  const csp = document.createElement("meta");
  csp.setAttribute("data-moire-csp", "");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute(
    "content",
    `default-src 'none'; script-src 'unsafe-inline'${render === "3d" ? " https://cdn.jsdelivr.net" : ""}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
  );
  const layout = document.createElement("style");
  layout.setAttribute("data-moire-layout-contract", ARTIFACT_LAYOUT_VERSION);
  layout.textContent = `[data-moire-chrome]{display:none!important}[data-moire-layout],[data-moire-stage],[data-moire-controls],[data-moire-caption]{max-width:100%}[data-moire-stage]{min-width:0}html[data-moire-layout-fallback="stage-first"],html[data-moire-layout-fallback="stage-first"] body{min-height:0!important}html[data-moire-layout-fallback="stage-first"] body{margin:0!important;padding:0!important;overflow-x:hidden!important}html[data-moire-layout-fallback="stage-first"] [data-moire-layout]{display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-areas:"stage" "controls" "caption"!important;gap:12px!important;width:100%!important;max-width:none!important;min-height:0!important;margin:0!important;padding:12px!important}html[data-moire-layout-fallback="stage-first"] [data-moire-support]{display:contents!important}html[data-moire-layout-fallback="stage-first"] [data-moire-stage]{grid-area:stage!important;width:100%!important;min-width:0!important;height:clamp(380px,68vw,560px)!important;min-height:clamp(380px,68vw,560px)!important;margin:0!important}html[data-moire-layout-fallback="stage-first"] [data-moire-stage]>canvas,html[data-moire-layout-fallback="stage-first"] [data-moire-stage]>svg,html[data-moire-layout-fallback="stage-first"] [data-moire-stage]>[data-moire-viewport]{display:block!important;width:100%!important;height:100%!important;min-height:0!important}html[data-moire-layout-fallback="stage-first"] [data-moire-controls]{grid-area:controls!important;display:grid!important;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))!important;gap:8px!important;width:100%!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}html[data-moire-layout-fallback="stage-first"] [data-moire-controls]>h1,html[data-moire-layout-fallback="stage-first"] [data-moire-controls]>h2,html[data-moire-layout-fallback="stage-first"] [data-moire-controls]>h3{display:none!important}html[data-moire-layout-fallback="stage-first"] [data-moire-control]{min-width:0!important;margin:0!important;padding:10px!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:8px!important;background:rgba(255,255,255,.035)!important;box-shadow:none!important}html[data-moire-layout-fallback="stage-first"] [data-moire-control] input[type=range]{width:100%!important}html[data-moire-layout-fallback="stage-first"] [data-moire-controls]>.hint,html[data-moire-layout-fallback="stage-first"] [data-moire-controls]>[data-moire-hint]{grid-column:1/-1!important;margin:0!important;padding:0 2px!important}html[data-moire-layout-fallback="stage-first"] [data-moire-caption]{grid-area:caption!important;display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:baseline!important;gap:12px!important;width:100%!important;margin:0!important;padding:8px 2px 0!important;border:0!important;border-top:1px solid rgba(255,255,255,.08)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}html[data-moire-layout-fallback="stage-first"] [data-moire-caption]>h1,html[data-moire-layout-fallback="stage-first"] [data-moire-caption]>h2,html[data-moire-layout-fallback="stage-first"] [data-moire-caption]>h3{margin:0!important;font-size:11px!important;line-height:1.4!important;letter-spacing:.08em!important;text-transform:uppercase!important;white-space:nowrap!important}html[data-moire-layout-fallback="stage-first"] [data-moire-caption]>p{margin:0!important;max-width:none!important;font-size:13px!important;line-height:1.45!important}@media(max-width:420px){html[data-moire-layout-fallback="stage-first"] [data-moire-layout]{padding:8px!important}html[data-moire-layout-fallback="stage-first"] [data-moire-stage]{height:clamp(300px,82vw,380px)!important;min-height:clamp(300px,82vw,380px)!important}html[data-moire-layout-fallback="stage-first"] [data-moire-controls]{grid-template-columns:1fr!important}html[data-moire-layout-fallback="stage-first"] [data-moire-caption]{grid-template-columns:1fr!important;gap:4px!important}}`;
  const bridge = document.createElement("script");
  bridge.setAttribute("data-moire-runtime-bridge", ARTIFACT_RUNTIME_BRIDGE_VERSION);
  bridge.textContent = `(()=>{const send=(kind,detail={})=>window.parent.postMessage({moire:kind,...detail},'*');let lastHeight=0;const enforceLayout=()=>{const root=document.documentElement;if(root.dataset.moireLayoutFallback)return;const stage=document.querySelector('[data-moire-stage]');if(!stage)return;const viewport=Math.max(root.clientWidth||0,window.innerWidth||0);const rect=stage.getBoundingClientRect();const minimumRatio=viewport<=${ARTIFACT_LAYOUT_LIMITS.narrowMaxWidth}?${ARTIFACT_LAYOUT_LIMITS.narrowStageRatio}:${ARTIFACT_LAYOUT_LIMITS.wideStageRatio};const overflows=root.scrollWidth>viewport+${ARTIFACT_LAYOUT_LIMITS.overflowTolerance};if(rect.width<viewport*minimumRatio||rect.height<${ARTIFACT_LAYOUT_LIMITS.minimumStageHeight}||overflows)root.dataset.moireLayoutFallback='stage-first'};const measure=()=>{enforceLayout();const height=Math.ceil(Math.max(document.documentElement?.scrollHeight||0,document.body?.scrollHeight||0));if(height>0&&Math.abs(height-lastHeight)>1){lastHeight=height;send('resize',{height})}};const observe=()=>{measure();if('ResizeObserver'in window){const observer=new ResizeObserver(measure);observer.observe(document.documentElement);if(document.body)observer.observe(document.body);window.addEventListener('pagehide',()=>observer.disconnect(),{once:true})}window.addEventListener('load',measure,{once:true});requestAnimationFrame(measure)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();window.addEventListener('keydown',(event)=>{if(event.key==='Escape')send('dismiss')});window.addEventListener('error',(event)=>send('runtime-error',{message:String(event.message||'Artifact runtime error').slice(0,500)}));window.addEventListener('unhandledrejection',(event)=>send('runtime-error',{message:String(event.reason||'Unhandled artifact rejection').slice(0,500)}))})();`;
  document.head.append(layout);
  document.head.prepend(bridge);
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

export async function generateArtifact(
  brief: VisualizationBrief,
  priority: ArtifactPriority = "interactive",
  queueKey?: string,
): Promise<ArtifactResult> {
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
  }, priority, queueKey);
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
