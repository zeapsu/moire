# Moiré

Moiré turns readable research papers and educational pages into interactive experiments without replacing the source. It preserves the paper as the primary reading surface, marks concepts that benefit from motion or controls, and opens each visualization in a sandboxed overlay that can be minimized into a per-page notebook.

**Live app:** https://moire-umber.vercel.app

## Try the seeded demo

- [Attention Is All You Need](https://moire-umber.vercel.app/1706.03762) — three instant views for scaled dot-product attention, multi-head attention, and positional encoding.
- [Spin-orbit quench dynamics](https://moire-umber.vercel.app/1811.05327) — three instant views for Kibble–Zurek domain formation, critical freeze-out, and split dispersion minima.
- [Double pendulum](https://moire-umber.vercel.app/https:/en.wikipedia.org/wiki/Double_pendulum) — an instant chaos simulation anchored to the Wikipedia article.

You can also paste an arXiv ID or any public `http`/`https` page with readable article content. The seeded pages use prevalidated artifacts so the demo is immediate and credit-efficient; every other supported page uses the same general model-backed scan and generation pipeline.

## How it works

1. The server safely fetches a page, preserves arXiv's LaTeXML structure when available, sanitizes it, and assigns stable source anchors.
2. A low-reasoning GPT-5.6 Luna scanner identifies up to six high-value concepts and returns typed visualization briefs tied to exact source selectors.
3. Moiré speculatively generates the top briefs while the reader continues through the original paper. Grok 4.5 produces one self-contained HTML artifact per brief through OpenRouter, with GPT-5.6 Terra as a request-failure fallback and GPT-5.6 Sol reserved for contract or browser-runtime repairs.
4. The server validates the artifact contract, network isolation, controls, and size. At most one validation repair and one browser-runtime repair are allowed, tracked independently with server-owned diagnostic state.
5. The browser runs the result in a script-only sandbox with a restrictive CSP. Vercel Runtime Cache preserves opaque artifact records and expensive results across serverless functions and replays.

Source-page links that target another section of the same document stay inside Moiré. External links remain explicit links to the original destination.

## Local setup

Requirements: Node.js 20.18.1 or newer and an OpenRouter API key. Provider BYOK credentials are configured in OpenRouter rather than exposed to this application.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set this value in `.env.local`:

```text
OPENROUTER_API_KEY=your_key_here
```

Then open `http://localhost:3000`. Set `MOIRE_QA_NO_AI=1` for ingestion and UI QA that must not call the model gateway.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
```

The test suite covers URL normalization, safe fetching, document ingestion, internal-link rewriting, structured scanning, artifact validation and repair policy, server-owned cache behavior, rate limiting, notebook persistence, API contracts, and the 3/3/1 seeded corpus.

## Build Week implementation

The primary Codex task owns the architecture, implementation, integration, deployment, and acceptance work. GPT-5.6 is used for the structured scanner, fallback generation, difficult repairs, and the preserved Sol/high demo set; Grok 4.5 is the default artifact generator selected by the project bakeoff. GitHub issues, pull requests, and git history are the project record.

## Current constraints

- Source pages must be public HTML that can be reduced to readable article content; PDFs and login-gated pages are not fetched.
- Generated artifacts are intentionally self-contained and network-isolated. A 3D artifact may import only the pinned Three.js module.
- Runtime cache entries expire after one hour. The notebook is per page and stored in the current browser session.
- Local development uses a conservative shared rate-limit bucket. Production uses Vercel-owned client IP headers.
