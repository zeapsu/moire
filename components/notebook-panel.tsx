"use client";

import type { NotebookEntry } from "@/lib/notebook";

export type NotebookStyle = "dock" | "rail";

type NotebookPanelProps = {
  entries: NotebookEntry[];
  open: boolean;
  style: NotebookStyle;
  onToggle: () => void;
  onStyleChange: (style: NotebookStyle) => void;
  onOpenEntry: (entry: NotebookEntry) => void;
  onRevealSource: (entry: NotebookEntry) => void;
};

export function NotebookPanel({
  entries,
  open,
  style,
  onToggle,
  onStyleChange,
  onOpenEntry,
  onRevealSource,
}: NotebookPanelProps) {
  // The notebook adds zero chrome until the first pin — readiness lives in the spine.
  if (entries.length === 0) return null;

  const panel = (
    <aside className={`notebook-panel is-${style}${style === "dock" ? " dock-enter" : ""}`} aria-label="Notebook">
      <div className="nb-hairline" aria-hidden="true" />
      <div className="nb-sheet-handle" aria-hidden="true"><i /></div>
      <header className="nb-head">
        <span>Notebook · {entries.length} pinned</span>
        <div className="nb-style" role="group" aria-label="Notebook style">
          {(["dock", "rail"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={style === option ? "is-active" : ""}
              aria-pressed={style === option}
              onClick={() => onStyleChange(option)}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      {entries.map((entry) => (
        <article className="nb-entry" key={entry.artifactId}>
          <button className="nb-title" type="button" onClick={() => onOpenEntry(entry)}>
            {entry.brief.title}
          </button>
          <span className="nb-desc">{entry.brief.concept}</span>
          <button className="nb-back" type="button" onClick={() => onRevealSource(entry)}>
            Back to source ↑
          </button>
        </article>
      ))}
    </aside>
  );

  return (
    <>
      <button
        type="button"
        className={`notebook-glyph${open ? ` is-open is-${style}` : ""}`}
        aria-expanded={open}
        aria-label={open ? "Collapse notebook" : `Open notebook, ${entries.length} pinned`}
        onClick={onToggle}
      >
        <span className="glyph-count">Notebook · {entries.length}</span>
        <span className="glyph-frame" aria-hidden="true" />
      </button>
      {open ? panel : null}
    </>
  );
}
