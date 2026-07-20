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
  });
});
