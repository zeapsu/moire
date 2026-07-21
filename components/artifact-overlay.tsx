"use client";

import { useEffect, useRef } from "react";
import { ArtifactFrame } from "@/components/artifact-frame";
import type { ArtifactDescriptor, RepairState } from "@/lib/types";

export type ArtifactView =
  | { status: "loading"; title: string; message: string; detail: string; descriptor?: ArtifactDescriptor }
  | { status: "error"; title: string; message: string; descriptor?: ArtifactDescriptor; repairState?: RepairState }
  | {
      status: "ready";
      descriptor: ArtifactDescriptor;
      html: string;
      repairState: RepairState;
      cached: boolean;
    };

type ArtifactOverlayProps = {
  view: ArtifactView;
  onClose: () => void;
  onMinimize: () => void;
  onRuntimeFailure: (message: string) => void;
};

export function ArtifactOverlay({ view, onClose, onMinimize, onRuntimeFailure }: ArtifactOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), iframe, [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const title = view.status === "ready" ? view.descriptor.brief.title : view.title;
  const references = view.status === "ready" ? (view.descriptor.brief.references ?? []) : [];

  return (
    <div
      className="artifact-overlay-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="artifact-overlay"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-overlay-title"
      >
        <header className="overlay-bar">
          <div>
            <span>{view.status === "ready" && view.cached ? "Speculative result · cached" : "Live experiment"}</span>
            <h2 id="artifact-overlay-title">{title}</h2>
          </div>
          <div className="overlay-actions">
            {view.status === "ready" ? (
              <button type="button" onClick={onMinimize}>Minimize to notebook</button>
            ) : null}
            <button className="overlay-close" type="button" onClick={onClose} ref={closeRef} aria-label="Close visualization">
              Close <kbd>Esc</kbd>
            </button>
          </div>
        </header>

        {references.length > 0 ? (
          <nav className="overlay-references" aria-label="Definitions used by this visualization">
            <span>Defined outside this paper</span>
            {references.map((reference) => (
              <a href={reference.url} target="_blank" rel="noreferrer" key={`${reference.term}:${reference.url}`}>
                {reference.term}: {reference.label} ↗
              </a>
            ))}
          </nav>
        ) : null}

        <div className="overlay-body" aria-live="polite">
          {view.status === "loading" ? (
            <div className="overlay-progress">
              <div className="moire-loader" aria-hidden="true" />
              <strong>{view.message}</strong>
              <p>{view.detail}</p>
            </div>
          ) : null}
          {view.status === "error" ? (
            <div className="overlay-error">
              <span>Experiment unavailable</span>
              <strong>{view.message}</strong>
              <p>Close this view and continue reading, or choose another highlighted passage.</p>
            </div>
          ) : null}
          {view.status === "ready" ? (
            <ArtifactFrame
              html={view.html}
              title={view.descriptor.brief.title}
              onRuntimeFailure={onRuntimeFailure}
              onDismiss={onClose}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
