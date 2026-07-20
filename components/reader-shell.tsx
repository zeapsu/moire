"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArtifactFrame } from "@/components/artifact-frame";
import type { ArtifactResult, IngestedDocument, RepairState, VisualizationBrief } from "@/lib/types";

type ArtifactState =
  | { status: "empty" }
  | { status: "loading"; brief: VisualizationBrief; message: string }
  | { status: "ready"; brief: VisualizationBrief; html: string; repairState: RepairState }
  | { status: "error"; brief?: VisualizationBrief; message: string; repairState?: RepairState };

export function ReaderShell({ document }: { document: IngestedDocument }) {
  const [briefs, setBriefs] = useState<VisualizationBrief[]>([]);
  const [scanState, setScanState] = useState<"loading" | "ready" | "error">("loading");
  const [scanError, setScanError] = useState("");
  const [artifact, setArtifact] = useState<ArtifactState>({ status: "empty" });
  const generationId = useRef(0);
  const generationController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function scan() {
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sections: document.sections }),
          signal: controller.signal,
        });
        const data = (await response.json()) as { briefs?: VisualizationBrief[]; error?: string };
        if (!response.ok || !data.briefs) throw new Error(data.error || "The page scan failed.");
        setBriefs(data.briefs);
        setScanState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setScanError(error instanceof Error ? error.message : "The page scan failed.");
        setScanState("error");
      }
    }
    void scan();
    return () => controller.abort();
  }, [document.sections]);

  const requestArtifact = useCallback(async (brief: VisualizationBrief, previousHtml?: string, runtimeError?: string, repairState?: RepairState) => {
    generationController.current?.abort();
    const controller = new AbortController();
    generationController.current = controller;
    const requestId = generationId.current + 1;
    generationId.current = requestId;
    setArtifact({
      status: "loading",
      brief,
      message: previousHtml ? "Repairing the experiment…" : "Building the experiment…",
    });
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, previousHtml, runtimeError, repairState }),
        signal: controller.signal,
      });
      const result = (await response.json()) as ArtifactResult;
      if (requestId !== generationId.current) return;
      if (!result.ok) {
        setArtifact({ status: "error", brief, message: result.error, repairState: result.repairState });
        return;
      }
      setArtifact({ status: "ready", brief, html: result.html, repairState: result.repairState });
    } catch (error) {
      if (controller.signal.aborted || requestId !== generationId.current) return;
      setArtifact({ status: "error", brief, message: error instanceof Error ? error.message : "The visualization could not be generated." });
    }
  }, []);

  useEffect(() => () => generationController.current?.abort(), []);

  const handleRuntimeFailure = useCallback((message: string) => {
    if (artifact.status !== "ready") return;
    if (artifact.repairState.attempts.runtime === 1) {
      setArtifact({
        status: "error",
        brief: artifact.brief,
        message: "The visualization could not start after its runtime repair.",
        repairState: { ...artifact.repairState, lastFailure: { stage: "runtime", message } },
      });
      return;
    }
    void requestArtifact(artifact.brief, artifact.html, message, artifact.repairState);
  }, [artifact, requestArtifact]);

  return (
    <div className="reader-page">
      <header className="reader-bar">
        <a className="wordmark" href="/">Moiré <span>β</span></a>
        <div className="source-address" title={document.targetUrl}>{document.targetUrl}</div>
        <a className="source-link" href={document.targetUrl} target="_blank" rel="noreferrer">Original ↗</a>
      </header>

      <main className="reader-grid">
        <article className="paper-pane">
          <header className="paper-meta">
            <p>{document.siteName}</p>
            <h1>{document.title}</h1>
            {document.byline ? <span>{document.byline}</span> : null}
          </header>
          <div className="reader-article" dangerouslySetInnerHTML={{ __html: document.html }} />
        </article>

        <aside className="lab-rail" aria-label="Visualization briefs">
          <div className="rail-heading">
            <p>Experiment rail</p>
            <span>{scanState === "loading" ? "Scanning" : `${briefs.length} found`}</span>
          </div>

          {scanState === "loading" ? (
            <div className="scan-card"><span className="scan-line" /><span className="scan-line short" /><p>Finding the parts worth touching…</p></div>
          ) : null}
          {scanState === "error" ? <div className="rail-error"><strong>Scan stopped</strong><p>{scanError}</p></div> : null}
          {scanState === "ready" && briefs.length === 0 ? (
            <div className="rail-empty"><strong>No strong experiments found</strong><p>Try a page with equations, figures, or dynamic systems.</p></div>
          ) : null}

          <div className="brief-list">
            {briefs.map((brief, index) => (
              <button
                className="brief-card"
                type="button"
                key={brief.span_id}
                data-anchor-selector={brief.anchor.dom_selector}
                onClick={() => void requestArtifact(brief)}
              >
                <span className="brief-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="brief-copy"><strong>{brief.title}</strong><small>{brief.concept}</small></span>
                <span className="brief-score">{Math.round(brief.score * 100)}</span>
              </button>
            ))}
          </div>

          <section className="artifact-panel" aria-live="polite">
            {artifact.status === "empty" ? (
              <div className="artifact-empty"><div className="mini-moire" /><p>Choose a brief to build its interactive view.</p></div>
            ) : null}
            {artifact.status === "loading" ? (
              <div className="artifact-loading"><span /><p>{artifact.message}</p><small>GPT-5.6 is writing and checking one self-contained artifact.</small></div>
            ) : null}
            {artifact.status === "error" ? (
              <div className="artifact-error"><strong>Experiment unavailable</strong><p>{artifact.message}</p></div>
            ) : null}
            {artifact.status === "ready" ? (
              <>
                <div className="artifact-title"><span>Live experiment</span><strong>{artifact.brief.title}</strong></div>
                <ArtifactFrame html={artifact.html} title={artifact.brief.title} onRuntimeFailure={handleRuntimeFailure} />
              </>
            ) : null}
          </section>
        </aside>
      </main>
    </div>
  );
}
