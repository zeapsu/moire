"use client";

import { FormEvent, PointerEvent, useState } from "react";
import { routeForTarget, TargetError } from "@/lib/target";

export function HomeForm() {
  const [value, setValue] = useState("1706.03762");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      window.location.assign(routeForTarget(value));
    } catch (caught) {
      setError(caught instanceof TargetError ? caught.message : "Enter a valid URL or arXiv ID.");
    }
  }

  function moveField(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  }

  return (
    <div className="home-field" onPointerMove={moveField}>
      <div className="moire-disc" aria-hidden="true" />
      <main className="home-shell">
        <nav className="home-nav" aria-label="Moiré">
          <a className="wordmark" href="/">
            Moiré <span>β</span>
          </a>
          <span className="nav-note">A reading instrument</span>
        </nav>

        <section className="hero">
          <p className="eyebrow">For papers that deserve to move</p>
          <h1>Turn the page into an experiment.</h1>
          <p className="hero-copy">
            Paste an arXiv paper or readable page. Moiré finds the ideas worth touching, then builds the controls that make them click.
          </p>

          <form className="target-form" onSubmit={submit}>
            <label htmlFor="target">Paper URL or arXiv ID</label>
            <div className="target-control">
              <input
                id="target"
                name="target"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                placeholder="https://arxiv.org/abs/1706.03762"
                autoComplete="url"
                spellCheck={false}
              />
              <button type="submit">Open as an experiment</button>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </form>

          <div className="examples" aria-label="Example pages">
            <span>Try</span>
            <button type="button" onClick={() => setValue("1706.03762")}>Attention is all you need</button>
            <button type="button" onClick={() => setValue("https://en.wikipedia.org/wiki/Double_pendulum")}>Double pendulum</button>
          </div>
        </section>

        <footer className="home-footer">
          <p><span>01</span> Read the source</p>
          <p><span>02</span> Find the moving parts</p>
          <p><span>03</span> Change the parameters</p>
        </footer>
      </main>
    </div>
  );
}
