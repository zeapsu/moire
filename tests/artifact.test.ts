import { describe, expect, it } from "vitest";
import { THREE_JS_URL, validateArtifact, withArtifactCsp } from "@/lib/artifact";

const valid2d = `<!doctype html><html><head><style>body{color:white}</style></head><body><label>Speed<input id="speed" type="range" min="0" max="1"></label><canvas></canvas><p>What you're seeing: speed changes the motion.</p><script>document.getElementById('speed').addEventListener('input',()=>{}); window.parent.postMessage({ready:true}, '*')</script></body></html>`;

describe("artifact validation", () => {
  it("accepts a self-contained 2D artifact", () => {
    expect(validateArtifact(valid2d, "2d")).toMatchObject({ ok: true, errors: [] });
  });

  it("enforces one bound slider per expected parameter", () => {
    const result = validateArtifact(valid2d, "2d", 2);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("expected at least 2");
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
    const html = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"${THREE_JS_URL}"}}</script></head><body><input id="depth" type="range"><p>What you're seeing: depth changes the scene.</p><script type="module">import * as THREE from 'three'; document.getElementById('depth').addEventListener('input',()=>{}); window.parent.postMessage({ready:true}, '*')</script></body></html>`;
    expect(validateArtifact(html, "3d").ok).toBe(true);
    expect(validateArtifact(html.replace(THREE_JS_URL, "https://evil.example/three.js"), "3d").ok).toBe(false);
  });

  it("injects a restrictive runtime CSP", () => {
    const secured = withArtifactCsp(valid2d, "2d");
    expect(secured).toContain("Content-Security-Policy");
    expect(secured).toContain("default-src 'none'");
    expect(secured).toContain("connect-src 'none'");
    expect(secured).toContain("data-moire-runtime-bridge");
    expect(withArtifactCsp(secured, "2d").match(/data-moire-runtime-bridge/g)).toHaveLength(1);
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
