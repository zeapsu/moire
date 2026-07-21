"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { routeForTarget, TargetError } from "@/lib/target";

const EXAMPLES = [
  { label: "Attention Is All You Need", tag: "arXiv", target: "1706.03762" },
  { label: "Double pendulum", tag: "Wikipedia", target: "https://en.wikipedia.org/wiki/Double_pendulum" },
  { label: "Defect formation in quenches", tag: "arXiv", target: "1811.05327" },
];

export function HomeForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [previewMotionAllowed, setPreviewMotionAllowed] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => setPreviewMotionAllowed(!reducedMotion.matches);

    syncMotionPreference();
    reducedMotion.addEventListener("change", syncMotionPreference);
    return () => reducedMotion.removeEventListener("change", syncMotionPreference);
  }, []);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    if (previewMotionAllowed) {
      void preview.play().catch(() => undefined);
      return;
    }

    preview.pause();
    preview.currentTime = 0;
  }, [previewMotionAllowed]);

  function open(target: string) {
    try {
      window.location.assign(routeForTarget(target));
    } catch (caught) {
      setError(caught instanceof TargetError ? caught.message : "Enter a valid URL or arXiv ID.");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    open(value);
  }

  return (
    <div className="home-page">
      <div className="top-hairline" aria-hidden="true" />
      <header className="source-bar">
        <a className="wordmark" href="/">Moiré <span>β</span></a>
        <span />
        <span className="bar-note">A reading instrument</span>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <p className="home-eyebrow">MOIRÉ · MWAH-RAY</p>
          <h1>Turn the page into an&nbsp;experiment.</h1>
          <p className="home-copy">
            Paste a link — a paper, an article, an essay. Moiré lays a second, interactive layer over
            the original page. Understanding emerges where the two overlap.
          </p>

          <form className="target-form" onSubmit={submit}>
            <label className="mono-label" htmlFor="target" style={{ position: "absolute", left: -9999 }}>
              Link or arXiv ID
            </label>
            <div className="target-control">
              <input
                id="target"
                name="target"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                placeholder="Link or arXiv ID"
                autoComplete="url"
                spellCheck={false}
              />
              <button type="submit">Open as an experiment <i aria-hidden="true">→</i></button>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </form>

          <div className="examples" aria-label="Example pages">
            <span>TRY</span>
            {EXAMPLES.map((example) => (
              <span className="example-item" key={example.target}>
                <button type="button" onClick={() => open(example.target)}>{example.label}</button>
                <span>{example.tag.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </section>

        {/* Actual cached reader interaction, kept decorative so the entry form remains the
            single action on the page. Reduced-motion visitors see the first frame. */}
        <section className="home-miniature" aria-hidden="true">
          <div className="mini-frame">
            <video
              ref={previewRef}
              className="home-preview-video"
              autoPlay={previewMotionAllowed}
              loop
              muted
              playsInline
              poster="/demo/reader-at-work-poster.jpg"
              preload={previewMotionAllowed ? "metadata" : "none"}
            >
              <source src="/demo/reader-at-work.mp4" type="video/mp4" />
            </video>
          </div>
          <span className="mini-caption">THE READER AT WORK — MARKS IN THE MARGIN, ONE EXPERIMENT OPEN</span>
        </section>
      </main>
    </div>
  );
}
