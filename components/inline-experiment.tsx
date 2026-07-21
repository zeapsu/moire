"use client";

import { useEffect, useRef } from "react";
import { ArtifactFrame } from "@/components/artifact-frame";
import type { ArtifactDescriptor, RepairState } from "@/lib/types";

export type ArtifactView =
  | { status: "loading"; anchor: string; title: string; message: string; detail: string; descriptor?: ArtifactDescriptor }
  | { status: "error"; anchor: string; title: string; message: string; descriptor?: ArtifactDescriptor; repairState?: RepairState }
  | { status: "ready"; anchor: string; descriptor: ArtifactDescriptor; html: string; repairState: RepairState; cached: boolean };

type InlineExperimentProps = {
  view: ArtifactView;
  pinned: boolean;
  onPin: () => void;
  onCollapse: () => void;
  onRetry?: () => void;
  onRuntimeFailure: (message: string) => void;
};

export function InlineExperiment({ view, pinned, onPin, onCollapse, onRetry, onRuntimeFailure }: InlineExperimentProps) {
  const collapseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    collapseRef.current?.focus({ preventScroll: true });
  }, []);

  const title = view.status === "ready" ? view.descriptor.brief.title : view.title;
  const references = view.status === "ready" ? (view.descriptor.brief.references ?? []) : [];

  return (
    <div className="slot-inner">
      <div className="experiment-tether" aria-hidden="true" />
      <section className="experiment-panel" aria-label={`Experiment: ${title}`}>
        <div className="panel-hairline" aria-hidden="true" />
        <header className="panel-head">
          <h2>{title}</h2>
          <div className="panel-actions">
            {view.status === "ready" ? (
              <button
                type="button"
                onClick={onPin}
                disabled={pinned}
                aria-label={pinned ? "Pinned to notebook" : "Pin to notebook"}
              >
                <span className="panel-action-label">{pinned ? "Pinned" : "Pin to notebook"}</span>
                <span aria-hidden="true">↓</span>
              </button>
            ) : null}
            <button type="button" onClick={onCollapse} ref={collapseRef} aria-label="Collapse experiment">
              <span className="panel-action-label">Collapse</span> <span aria-hidden="true">↑</span> <kbd>Esc</kbd>
            </button>
          </div>
        </header>

        <div className="panel-body" aria-live="polite">
          {view.status === "loading" ? (
            <div className="panel-loading">
              <span className="panel-status">◨ Running experiment…</span>
              <div className="panel-progress" aria-hidden="true"><i /></div>
              <p>{view.message} {view.detail}</p>
            </div>
          ) : null}
          {view.status === "error" ? (
            <div className="panel-error">
              <span className="panel-status is-error">⚠ Experiment failed to run</span>
              <p>{view.message}</p>
              {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
            </div>
          ) : null}
          {view.status === "ready" ? (
            <ArtifactFrame
              html={view.html}
              title={view.descriptor.brief.title}
              onRuntimeFailure={onRuntimeFailure}
              onDismiss={onCollapse}
            />
          ) : null}
        </div>

        {references.length > 0 ? (
          <nav className="panel-references" aria-label="Definitions used by this experiment">
            <span>Defined outside this source</span>
            {references.map((reference) => (
              <a href={reference.url} target="_blank" rel="noreferrer" key={`${reference.term}:${reference.url}`}>
                <b>{reference.term}</b> — {reference.label} ↗
              </a>
            ))}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
