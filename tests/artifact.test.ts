import { describe, expect, it } from "vitest";
import {
  generatorInstructions,
  isIgnorableArtifactRuntimeError,
  SVG_NAMESPACE_URL,
  shouldUseStageFirstFallback,
  THREE_JS_URL,
  validateArtifact,
  withArtifactCsp,
} from "@/lib/artifact";
import type { VisualizationBrief } from "@/lib/types";

const valid2d = `<!doctype html><html><head><style>body{color:white}</style></head><body><main data-moire-layout><section data-moire-stage><canvas></canvas></section><section data-moire-controls><label data-moire-control>Speed<input id="speed" type="range" min="0" max="1"></label></section><section data-moire-caption><p>What you're seeing: speed changes the motion.</p></section></main><script>document.getElementById('speed').addEventListener('input',()=>{}); window.parent.postMessage({ready:true}, '*')</script></body></html>`;

describe("artifact validation", () => {
  const brief = {
    span_id: "s-1",
    anchor: { section: "Geometry", element_type: "paragraph", dom_selector: "#p-1", text_excerpt: "A spatial surface." },
    title: "Spatial surface",
    concept: "A spatial surface",
    viz_kind: "3d-scene",
    render: "3d",
    governing_math: "z = x + y",
    grounding_terms: ["spatial surface"],
    references: [],
    parameters: [{ name: "Height", symbol: "z", default: 1, min: 0, max: 2, unit: "" }],
    expected_behavior: "The surface height changes.",
    score: 0.9,
  } satisfies VisualizationBrief;

  it("gives 3D generation an explicit Three.js scene and lifecycle contract", () => {
    const instructions = generatorInstructions(brief);
    expect(instructions).toContain(THREE_JS_URL);
    expect(instructions).toContain("THREE.Scene");
    expect(instructions).toContain("WebGLRenderer");
    expect(instructions).toContain("ResizeObserver");
    expect(instructions).toContain("dispose");
    expect(instructions).toContain("pagehide");
    expect(instructions).toContain("pointer drag");
    expect(instructions).toContain("first complete frame");
    expect(instructions).toContain("visual expression");
    expect(instructions).toContain("at least 72%");
    expect(instructions).toContain("emit no h1 element");
    expect(instructions).toContain("stage-first fallback");
    expect(instructions).toContain("Preserve mathematical notation");
    expect(instructions).toContain("text never overlaps");
  });

  it("ignores only browser-defined ResizeObserver loop notifications", () => {
    expect(isIgnorableArtifactRuntimeError("ResizeObserver loop limit exceeded")).toBe(true);
    expect(
      isIgnorableArtifactRuntimeError("ResizeObserver loop completed with undelivered notifications."),
    ).toBe(true);
    expect(isIgnorableArtifactRuntimeError("ResizeObserver is not defined")).toBe(false);
    expect(isIgnorableArtifactRuntimeError("Canvas initialization failed.")).toBe(false);

    const secured = withArtifactCsp(valid2d, "2d");
    expect(secured).toContain('data-moire-runtime-bridge="5"');
    expect(secured).toContain("ignorableRuntimeError");
    expect(secured).toContain("send('runtime-error'");
  });

  it("keeps Three.js out of the 2D generation contract", () => {
    const instructions = generatorInstructions({ ...brief, viz_kind: "interactive-plot", render: "2d" });
    expect(instructions).not.toContain(THREE_JS_URL);
    expect(instructions).not.toContain("THREE.Scene");
  });

  it("accepts a self-contained 2D artifact", () => {
    expect(validateArtifact(valid2d, "2d")).toMatchObject({ ok: true, errors: [] });
  });

  it("enforces one bound slider per expected parameter", () => {
    const result = validateArtifact(valid2d, "2d", 2);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("expected at least 2");
  });

  it("requires semantic layout hooks without prescribing the artifact style", () => {
    for (const attribute of ["data-moire-layout", "data-moire-stage", "data-moire-controls", "data-moire-caption"]) {
      const result = validateArtifact(valid2d.replace(attribute, `data-missing-${attribute}`), "2d");
      expect(result.ok, attribute).toBe(false);
      expect(result.errors.join(" "), attribute).toContain(attribute);
    }
    expect(
      validateArtifact(valid2d.replace("data-moire-control>", "data-missing-control>"), "2d").errors.join(" "),
    ).toContain("data-moire-control");
  });

  it.each([
    ["narrow full-width stage", false, { viewportWidth: 600, stageWidth: 432, stageHeight: 300, scrollWidth: 602 }],
    ["creative wide composition", false, { viewportWidth: 1_000, stageWidth: 580, stageHeight: 420, scrollWidth: 1_002 }],
    ["cramped narrow stage", true, { viewportWidth: 600, stageWidth: 280, stageHeight: 500, scrollWidth: 600 }],
    ["short stage", true, { viewportWidth: 600, stageWidth: 560, stageHeight: 299, scrollWidth: 600 }],
    ["horizontal overflow", true, { viewportWidth: 600, stageWidth: 560, stageHeight: 400, scrollWidth: 603 }],
  ])("uses the stage-first fallback for %s only when hard limits fail", (_name, expected, metrics) => {
    expect(shouldUseStageFirstFallback(metrics)).toBe(expected);
  });

  it("rejects duplicate regions, controls outside their region, and repeated artifact titles", () => {
    const duplicateStage = valid2d.replace("</main>", "<section data-moire-stage></section></main>");
    const outsideControls = valid2d.replace(
      '<label data-moire-control>Speed<input id="speed" type="range" min="0" max="1"></label>',
      "",
    ).replace("</main>", '<label data-moire-control>Speed<input id="speed" type="range" min="0" max="1"></label></main>');
    const duplicateTitle = valid2d.replace("<canvas></canvas>", "<h1>Repeated title</h1><canvas></canvas>");
    expect(validateArtifact(duplicateStage, "2d").errors.join(" ")).toContain("exactly one data-moire-stage");
    expect(validateArtifact(outsideControls, "2d").errors.join(" ")).toContain("inside data-moire-controls");
    expect(validateArtifact(duplicateTitle, "2d").errors.join(" ")).toContain("must not repeat");
  });

  it("rejects network access and a missing ready handshake", () => {
    const html = `<!doctype html><html><body><input id="speed" type="range"><p>What you're seeing</p><script>document.getElementById('speed').addEventListener('input',()=>{}); fetch('https://example.com/data')</script></body></html>`;
    const result = validateArtifact(html, "2d");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("ready");
    expect(result.errors.join(" ")).toContain("network");
  });

  it("scans inline event-handler code for prohibited network and navigation behavior", () => {
    const fetchHandler = valid2d.replace("<canvas></canvas>", `<button onclick="fetch('https://evil.example')">Run</button><canvas></canvas>`);
    const navigationHandler = valid2d.replace("<canvas></canvas>", `<button onclick="window.location='https://evil.example'">Run</button><canvas></canvas>`);
    const declarationBypass = valid2d.replace(
      "<canvas></canvas>",
      `<button onclick="render(location); location='/elsewhere'">Run</button><canvas></canvas>`,
    );
    expect(validateArtifact(fetchHandler, "2d").errors.join(" ")).toContain("network");
    expect(validateArtifact(navigationHandler, "2d").errors.join(" ")).toContain("navigation");
    expect(validateArtifact(declarationBypass, "2d").errors.join(" ")).toContain("navigation");
  });

  it("does not let a local declaration in one executable unit mask navigation in another", () => {
    const html = valid2d
      .replace("document.getElementById", "let location = { x: 0 }; document.getElementById")
      .replace("<canvas></canvas>", `<button onclick="location='/elsewhere'">Run</button><canvas></canvas>`);
    expect(validateArtifact(html, "2d").errors.join(" ")).toContain("navigation");
  });

  it("rejects relative and protocol-relative network surfaces", () => {
    expect(validateArtifact(valid2d.replace("<canvas></canvas>", '<img src="//tracker.example/pixel">'), "2d").ok).toBe(false);
    expect(validateArtifact(valid2d.replace("<canvas></canvas>", '<script src="/remote.js"></script>'), "2d").ok).toBe(false);
    expect(validateArtifact(valid2d.replace("body{color:white}", "body{background:url(/remote.png)}"), "2d").ok).toBe(false);
  });

  it("allows only the pinned three.js import in a 3D artifact", () => {
    const html = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"${THREE_JS_URL}"}}</script></head><body><main data-moire-layout><section data-moire-stage><div id="scene"></div></section><section data-moire-controls><label data-moire-control>Depth<input id="depth" type="range"></label></section><section data-moire-caption><p>What you're seeing: depth changes the scene.</p></section></main><script type="module">import * as THREE from 'three'; document.getElementById('depth').addEventListener('input',()=>{}); window.parent.postMessage({ready:true}, '*')</script></body></html>`;
    expect(validateArtifact(html, "3d").ok).toBe(true);
    expect(validateArtifact(html.replace(THREE_JS_URL, "https://evil.example/three.js"), "3d").ok).toBe(false);
  });

  it("injects a restrictive runtime CSP", () => {
    const secured = withArtifactCsp(valid2d, "2d");
    expect(secured).toContain("Content-Security-Policy");
    expect(secured).toContain("default-src 'none'");
    expect(secured).toContain("connect-src 'none'");
    expect(secured).toContain('data-moire-runtime-bridge="5"');
    expect(secured).toContain('data-moire-layout-contract="1"');
    expect(secured).toContain("ResizeObserver");
    expect(secured).toContain("send('resize',{height})");
    expect(secured).toContain("layoutReady=true");
    expect(secured).toContain("wrapper.setAttribute('data-moire-support','')");
    expect(secured).toContain("moireLayoutFallback='stage-first'");
    expect(withArtifactCsp(secured, "2d").match(/data-moire-runtime-bridge/g)).toHaveLength(1);
    expect(withArtifactCsp(secured, "2d").match(/data-moire-layout-contract/g)).toHaveLength(1);
  });

  it("does not mistake JavaScript comments, prose, or local location variables for network access", () => {
    const html = valid2d
      .replace("speed changes the motion.", "the simulation does not fetch (or import) any external data.")
      .replace("document.getElementById", "//---- setup ----\nlet location = { x: 0, y: 0 };\ndocument.getElementById");
    expect(validateArtifact(html, "2d")).toMatchObject({ ok: true, errors: [] });
    expect(validateArtifact(valid2d.replace("document.getElementById", "particle.location = { x: 1 }; document.getElementById"), "2d").ok).toBe(true);
    expect(validateArtifact(valid2d.replace("document.getElementById", "location.href = 'https://example.com'; document.getElementById"), "2d").ok).toBe(false);
  });

  it("allows self-contained data URI assignments but still rejects network assignments", () => {
    const dataArtifact = valid2d.replace(
      "document.getElementById",
      "const img = new Image(); img.src = 'data:image/png;base64,iVBORw0KGgo='; document.getElementById",
    );
    const networkArtifact = valid2d.replace(
      "document.getElementById",
      "const img = new Image(); img.src = 'https://tracker.example/pixel'; document.getElementById",
    );
    expect(validateArtifact(dataArtifact, "2d").ok).toBe(true);
    expect(validateArtifact(networkArtifact, "2d").ok).toBe(false);
  });

  it("allows the inert SVG namespace without allowing another URL literal", () => {
    const svg = valid2d.replace(
      "document.getElementById",
      `document.createElementNS('${SVG_NAMESPACE_URL}', 'svg'); document.getElementById`,
    );
    expect(validateArtifact(svg, "2d").ok).toBe(true);
    expect(validateArtifact(svg.replace(SVG_NAMESPACE_URL, "https://evil.example/svg"), "2d").ok).toBe(false);
  });

  it("accepts equivalent quoted, reordered, and variable ready payloads", () => {
    const quoted = valid2d.replace("{ready:true}", '{"ready": true}');
    const reordered = valid2d.replace("{ready:true}", "{status: 'ok', ready: true}");
    const variable = valid2d.replace(
      "window.parent.postMessage({ready:true}, '*')",
      "const message = {ready:true}; window.parent.postMessage(message, '*')",
    );
    expect(validateArtifact(quoted, "2d").ok).toBe(true);
    expect(validateArtifact(reordered, "2d").ok).toBe(true);
    expect(validateArtifact(variable, "2d").ok).toBe(true);
  });
});
