"use client";

import { useEffect, useRef, useState } from "react";

type ArtifactFrameProps = {
  html: string;
  title: string;
  instant?: boolean;
  onRuntimeFailure: (message: string) => void;
  onDismiss?: () => void;
};

export function ArtifactFrame({ html, title, instant = false, onRuntimeFailure, onDismiss }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const failureRef = useRef(onRuntimeFailure);
  const dismissRef = useRef(onDismiss);
  const readyRef = useRef(false);
  const failedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    failureRef.current = onRuntimeFailure;
  }, [onRuntimeFailure]);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    readyRef.current = false;
    failedRef.current = false;
    setReady(false);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data && typeof event.data === "object" && event.data.ready === true) {
        readyRef.current = true;
        setReady(true);
        return;
      }
      if (event.data && typeof event.data === "object" && event.data.moire === "dismiss") {
        dismissRef.current?.();
        return;
      }
      if (
        !failedRef.current &&
        event.data &&
        typeof event.data === "object" &&
        event.data.moire === "runtime-error"
      ) {
        failedRef.current = true;
        failureRef.current(
          typeof event.data.message === "string" ? event.data.message.slice(0, 500) : "The artifact reported a runtime error.",
        );
      }
    };
    window.addEventListener("message", receive);
    const timeout = window.setTimeout(() => {
      if (!readyRef.current && !failedRef.current) {
        failedRef.current = true;
        failureRef.current("The artifact did not send its ready handshake within 5 seconds.");
      }
    }, 5_000);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timeout);
    };
  }, [html]);

  return (
    <div className="artifact-runtime">
      {!ready && !instant ? <div className="runtime-status">◨ Starting the experiment…</div> : null}
      <iframe
        ref={iframeRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={html}
        className={ready || instant ? "is-ready" : ""}
      />
    </div>
  );
}
