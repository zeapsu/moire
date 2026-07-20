"use client";

import type { NotebookEntry } from "@/lib/notebook";
import type { ArtifactDescriptor } from "@/lib/types";

type NotebookRailProps = {
  scanState: "loading" | "ready" | "error";
  scanError: string;
  artifacts: ArtifactDescriptor[];
  entries: NotebookEntry[];
  onOpen: (entry: NotebookEntry) => void;
  onRevealSource: (entry: NotebookEntry) => void;
};

export function NotebookRail({
  scanState,
  scanError,
  artifacts,
  entries,
  onOpen,
  onRevealSource,
}: NotebookRailProps) {
  const speculative = artifacts.slice(0, 3);
  const readyCount = speculative.filter((artifact) => artifact.status === "ready").length;
  const failedCount = speculative.filter((artifact) => artifact.status === "error").length;

  return (
    <aside className="notebook-rail" aria-label="Visualization notebook">
      <div className="notebook-heading">
        <div><span>Per-page history</span><h2>Notebook</h2></div>
        <b>{entries.length}</b>
      </div>

      <section className="speculation-meter" aria-live="polite">
        <div>
          <span className={scanState === "error" ? "is-error" : ""} />
          <strong>
            {scanState === "loading" ? "Scanning the paper" : scanState === "error" ? "Scan stopped" : "Speculative views"}
          </strong>
        </div>
        {scanState === "loading" ? <p>Finding passages that become clearer when they move.</p> : null}
        {scanState === "error" ? <p>{scanError}</p> : null}
        {scanState === "ready" && artifacts.length === 0 ? <p>No strong interactive passages were found.</p> : null}
        {scanState === "ready" && artifacts.length > 0 ? (
          <p>{readyCount} of {speculative.length} ready{failedCount ? ` · ${failedCount} unavailable` : ""}. Hover a marked passage.</p>
        ) : null}
        {speculative.length > 0 ? (
          <div className="speculation-dots" aria-hidden="true">
            {speculative.map((artifact) => <i className={`is-${artifact.status}`} key={artifact.artifactId} />)}
          </div>
        ) : null}
      </section>

      <div className="notebook-list">
        {entries.length === 0 ? (
          <div className="notebook-empty">
            <div className="mini-moire" />
            <strong>Your experiments collect here.</strong>
            <p>Open a marked passage, then minimize it without losing your place.</p>
          </div>
        ) : null}
        {entries.map((entry, index) => (
          <article className="notebook-entry" key={entry.artifactId}>
            <button className="notebook-open" type="button" onClick={() => onOpen(entry)}>
              <span>{String(entries.length - index).padStart(2, "0")}</span>
              <strong>{entry.brief.title}</strong>
              <small>{entry.brief.concept}</small>
            </button>
            <button className="notebook-source" type="button" onClick={() => onRevealSource(entry)}>
              Back to source <span aria-hidden="true">↗</span>
            </button>
          </article>
        ))}
      </div>
    </aside>
  );
}
