"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const ARTIFACT_HEIGHT_LIMITS = { min: 300, max: 1_200 } as const;

export function normalizeArtifactHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(ARTIFACT_HEIGHT_LIMITS.min, Math.min(ARTIFACT_HEIGHT_LIMITS.max, Math.ceil(value)));
}

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
  const [artifactHeight, setArtifactHeight] = useState<number | null>(null);

  useEffect(() => {
    failureRef.current = onRuntimeFailure;
  }, [onRuntimeFailure]);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    readyRef.current = instant;
    failedRef.current = false;
    setReady(instant);
    setArtifactHeight(null);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data && typeof event.data === "object" && event.data.moire === "resize") {
        const nextHeight = normalizeArtifactHeight(event.data.height);
        if (nextHeight !== null) setArtifactHeight(nextHeight);
        return;
      }
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
    const timeout = instant
      ? null
      : window.setTimeout(() => {
          if (!readyRef.current && !failedRef.current) {
            failedRef.current = true;
            failureRef.current("The artifact did not send its ready handshake within 5 seconds.");
          }
        }, 5_000);
    return () => {
      window.removeEventListener("message", receive);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [html, instant]);

  return (
    <div className="artifact-runtime" style={artifactHeight === null ? undefined : { height: artifactHeight }}>
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
