"use client";

import { useEffect, useRef, useState } from "react";

type ArtifactFrameProps = {
  html: string;
  title: string;
  onRuntimeFailure: (message: string) => void;
};

export function ArtifactFrame({ html, title, onRuntimeFailure }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const failureRef = useRef(onRuntimeFailure);
  const readyRef = useRef(false);
  const [activeHtml, setActiveHtml] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    failureRef.current = onRuntimeFailure;
  }, [onRuntimeFailure]);

  useEffect(() => {
    readyRef.current = false;
    setReady(false);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data && typeof event.data === "object" && event.data.ready === true) {
        readyRef.current = true;
        setReady(true);
      }
    };
    window.addEventListener("message", receive);
    setActiveHtml(html);
    const timeout = window.setTimeout(() => {
      if (!readyRef.current) failureRef.current("The artifact did not send its ready handshake within 5 seconds.");
    }, 5_000);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timeout);
    };
  }, [html]);

  return (
    <div className="artifact-runtime">
      {!ready ? <div className="runtime-status"><span /> Starting the experiment…</div> : null}
      <iframe
        ref={iframeRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={activeHtml}
        className={ready ? "is-ready" : ""}
      />
    </div>
  );
}
