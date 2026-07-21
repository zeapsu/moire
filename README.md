# Moiré

Moiré turns readable research papers and educational pages into interactive experiments while keeping the source content central. It keeps the paper as the primary reading surface, marks concepts that benefit from motion or controls, and opens each visualization inline beside the passage that inspired it.

**Live app:** https://moire-umber.vercel.app

**Demo video:** https://youtu.be/WFX1l93bmEo

## Try the seeded demo

- [Attention Is All You Need](https://moire-umber.vercel.app/1706.03762) — three instant views for scaled dot-product attention, multi-head attention, and positional encoding.
- [Spin-orbit quench dynamics](https://moire-umber.vercel.app/1811.05327) — three instant views for Kibble–Zurek domain formation, critical freeze-out, and split dispersion minima.
- [Double pendulum](https://moire-umber.vercel.app/https:/en.wikipedia.org/wiki/Double_pendulum) — an instant chaos simulation anchored to the Wikipedia article.
- [3D Gaussian Splatting](https://moire-umber.vercel.app/2308.04079) — an instant Three.js comparison of anisotropic and isotropic Gaussian representations.

You can also paste an arXiv ID or any public `http`/`https` page with readable article content. The seeded pages use prevalidated artifacts so the demo is immediate and credit-efficient; every other supported page uses the same general model-backed scan and generation pipeline.

## How it works

1. The server safely fetches a page, preserves safe arXiv LaTeXML structure when available, sanitizes it, and assigns stable source anchors.
2. A low-reasoning GPT-5.6 Luna scanner identifies up to six high-value concepts and returns typed visualization briefs tied to exact source selectors.
3. Moiré speculatively generates the top briefs while the reader continues through the source-derived reading view. Grok 4.5 produces one self-contained HTML artifact per brief through OpenRouter, with GPT-5.6 Terra as a generation fallback and GPT-5.6 Sol reserved for contract or browser-runtime repairs.
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

The test suite covers URL normalization, safe fetching, document ingestion, internal-link rewriting, structured scanning, artifact validation and repair policy, server-owned cache behavior, rate limiting, notebook persistence, API contracts, and the 3/3/1/1 seeded corpus.

## Judge walkthrough

The four links above are the fastest path through the product. They require no account and open prevalidated seeded artifacts without waiting for model generation.

1. Open **Attention Is All You Need**, choose a marked passage, and open its experiment. Change the key dimension or query row, pin the result, collapse it, and reopen it from the notebook.
2. Open **Spin-orbit quench dynamics** to compare three different source-grounded physics experiments.
3. Open **Double pendulum** to verify that the same reader and visualization flow works beyond arXiv.
4. Open **3D Gaussian Splatting** to exercise the responsive Three.js artifact contract.
5. Optionally select a focused passage on any supported page and choose **Visualize selection**. This runs the live model-backed path and can take longer than the seeded demonstrations.

## Build Week implementation

Moiré was developed through one primary Codex task that owned architecture, core implementation, integration, review, verification, and deployment. Codex translated the Build Week epic and linked issues into an implementation sequence, then used test and browser-QA results to refine source ingestion, server-owned caching, selection guardrails, artifact sandboxing, responsive visualization contracts, and independently bounded repairs.

GPT-5.6 Luna powers the structured source scanner, GPT-5.6 Terra provides a safe generation fallback, and GPT-5.6 Sol handles difficult validation or browser-runtime repairs. The preserved seeded demonstration set was generated with GPT-5.6 Sol at high reasoning, while Grok 4.5 became the default generator after a controlled model bakeoff. Git history, GitHub issues, and pull requests preserve the development record.

## A note about arXiv HTML

Moiré prefers arXiv's official accessible HTML and preserves its safe LaTeXML structure where possible, with an ar5iv fallback when official HTML is unavailable. These HTML pages are conversions of the paper's TeX source and may not reproduce every complex table, equation, or figure exactly as the PDF does. Moiré's sanitization and responsive reflow can introduce additional small differences. Use **Original ↗** to inspect the canonical source. If a problem also appears in arXiv's official HTML, see [arXiv's accessible HTML guidance](https://info.arxiv.org/about/accessible_HTML.html) for reporting options.

## Current constraints

- Source pages must be public HTML that can be reduced to readable article content; PDFs and login-gated pages are not fetched.
- Generated artifacts are intentionally self-contained and network-isolated. A 3D artifact may import only the pinned Three.js module.
- Runtime cache entries expire after one hour. The notebook is per page and persists in local browser storage.
- Local development uses a conservative shared rate-limit bucket. Production uses Vercel-owned client IP headers.
