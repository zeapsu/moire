"use client";

import { FormEvent, useState } from "react";
import { routeForTarget, TargetError } from "@/lib/target";

const EXAMPLES = [
  { label: "Attention Is All You Need", tag: "arXiv", target: "1706.03762" },
  { label: "Double pendulum", tag: "Wikipedia", target: "https://en.wikipedia.org/wiki/Double_pendulum" },
  { label: "Defect formation in quenches", tag: "arXiv", target: "1811.05327" },
];

export function HomeForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

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

        {/* ponytail: static miniature built from board components; upgrade path is the real
            reader at 0.33 scale rendering a cached source. */}
        <section className="home-miniature" aria-hidden="true">
          <div className="mini-frame">
            <div className="top-hairline" />
            <div className="mini-bar">
              <span className="wordmark">Moiré <span>β</span></span>
              <span className="mini-url">en.wikipedia.org/wiki/Double_pendulum</span>
              <span className="mini-ext">↗</span>
            </div>
            <div className="mini-body">
              <div className="mini-spine">
                <i />
                <b style={{ top: "16%" }} />
                <b className="is-open" style={{ top: "42%" }} />
                <b style={{ top: "76%" }} />
              </div>
              <div className="mini-page">
                <div className="mini-greek"><i style={{ width: "100%" }} /><i style={{ width: "93%" }} /><i style={{ width: "55%" }} /></div>
                <p>For large initial angles <span className="mini-mark">the motion of the double pendulum is chaotic</span> — nearby trajectories separate rapidly.</p>
                <div className="mini-tether" />
                <div className="mini-panel">
                  <div className="mini-panel-hairline" />
                  <div className="mini-panel-title">Motion of the double pendulum</div>
                  <div className="mini-plot"><span>interactive plot — trace of the lower bob</span></div>
                  <div className="mini-controls">
                    <span>θ₁</span>
                    <div className="mini-slider"><i /><b /></div>
                    <span className="mini-value">120°</span>
                  </div>
                </div>
                <div className="mini-greek" style={{ marginBottom: 0 }}><i style={{ width: "100%" }} /><i style={{ width: "96%" }} /><i style={{ width: "38%" }} /></div>
              </div>
            </div>
          </div>
          <span className="mini-caption">THE READER AT WORK — MARKS IN THE MARGIN, ONE EXPERIMENT OPEN</span>
        </section>
      </main>
    </div>
  );
}
