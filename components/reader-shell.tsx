"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArtifactOverlay, type ArtifactView } from "@/components/artifact-overlay";
import { NotebookRail } from "@/components/notebook-rail";
import { addNotebookEntry, notebookStorageKey, parseNotebook, type NotebookEntry } from "@/lib/notebook";
import type {
  ArtifactDescriptor,
  ArtifactStatus,
  CachedArtifactResult,
  IngestedDocument,
  RepairState,
  ScanSection,
} from "@/lib/types";

type StoredArtifact = {
  html: string;
  repairState: RepairState;
};

type AnchorPrompt =
  | { kind: "artifact"; artifactId: string; top: number; left: number }
  | { kind: "selection"; section: ScanSection; top: number; left: number };

type ArtifactRequestOptions = {
  intent: "interactive" | "prefetch";
  open: boolean;
  runtimeError?: string;
  preserveRestoreFocus?: boolean;
};

function promptPosition(rect: DOMRect): { top: number; left: number } {
  const width = 190;
  const left = rect.right + width + 20 < window.innerWidth ? rect.right + 12 : Math.max(12, rect.right - width);
  return { top: Math.max(76, Math.min(window.innerHeight - 92, rect.top - 8)), left };
}

function responseMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

export function ReaderShell({ document: sourceDocument }: { document: IngestedDocument }) {
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);
  const [scanState, setScanState] = useState<"loading" | "ready" | "error">("loading");
  const [scanError, setScanError] = useState("");
  const [view, setView] = useState<ArtifactView | null>(null);
  const [prompt, setPrompt] = useState<AnchorPrompt | null>(null);
  const [notebook, setNotebook] = useState<NotebookEntry[]>([]);
  const [notebookLoaded, setNotebookLoaded] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);
  const resultCache = useRef(new Map<string, StoredArtifact>());
  const activeRequestId = useRef(0);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const flashTimer = useRef<number | null>(null);

  const updateArtifactStatus = useCallback((artifactId: string, status: ArtifactStatus) => {
    setArtifacts((current) =>
      current.map((artifact) => (artifact.artifactId === artifactId ? { ...artifact, status } : artifact)),
    );
  }, []);

  const saveToNotebook = useCallback((descriptor: ArtifactDescriptor) => {
    setNotebook((current) =>
      addNotebookEntry(current, {
        artifactId: descriptor.artifactId,
        brief: descriptor.brief,
        savedAt: Date.now(),
      }),
    );
  }, []);

  const requestArtifact = useCallback(
    async (descriptor: ArtifactDescriptor, options: ArtifactRequestOptions) => {
      const local = !options.runtimeError ? resultCache.current.get(descriptor.artifactId) : undefined;
      if (local) {
        saveToNotebook(descriptor);
        if (options.open) {
          if (!options.preserveRestoreFocus) restoreFocus.current = window.document.activeElement as HTMLElement | null;
          setView({ status: "ready", descriptor, html: local.html, repairState: local.repairState, cached: true });
        }
        updateArtifactStatus(descriptor.artifactId, "ready");
        return;
      }

      const requestId = options.open ? activeRequestId.current + 1 : 0;
      if (options.open) {
        activeRequestId.current = requestId;
        if (!options.preserveRestoreFocus) restoreFocus.current = window.document.activeElement as HTMLElement | null;
        setView({
          status: "loading",
          title: descriptor.brief.title,
          message: options.runtimeError ? "Repairing the experiment…" : "Building the experiment…",
          detail: options.runtimeError
            ? "The first browser run reported a problem. The server is using this artifact's one runtime repair."
            : options.intent === "prefetch"
              ? "Opening the result prepared while you were reading."
              : "GPT-5.6 is writing and checking one self-contained interactive view.",
          descriptor,
        });
      }
      updateArtifactStatus(descriptor.artifactId, options.runtimeError ? "repairing" : "generating");

      let response: Response;
      let data: unknown;
      try {
        response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            artifactId: descriptor.artifactId,
            intent: options.intent,
            ...(options.runtimeError ? { runtimeError: options.runtimeError } : {}),
          }),
        });
        data = await response.json();
      } catch (error) {
        updateArtifactStatus(descriptor.artifactId, "idle");
        if (options.open && requestId === activeRequestId.current) {
          setView({
            status: "error",
            title: descriptor.brief.title,
            descriptor,
            message: error instanceof Error ? error.message : "The visualization request could not be completed.",
          });
        }
        return;
      }

      const result = data as Partial<CachedArtifactResult>;
      if (response.ok && result.ok === true && typeof result.html === "string" && result.repairState) {
        resultCache.current.set(descriptor.artifactId, { html: result.html, repairState: result.repairState });
        updateArtifactStatus(descriptor.artifactId, "ready");
        saveToNotebook(descriptor);
        if (options.open && requestId === activeRequestId.current) {
          setView({
            status: "ready",
            descriptor: { ...descriptor, status: "ready" },
            html: result.html,
            repairState: result.repairState,
            cached: result.cached === true || options.intent === "prefetch",
          });
        }
        return;
      }

      const terminal = response.status === 422;
      updateArtifactStatus(descriptor.artifactId, terminal ? "error" : "idle");
      if (options.open && requestId === activeRequestId.current) {
        setView({
          status: "error",
          title: descriptor.brief.title,
          descriptor,
          message: responseMessage(data, "The visualization could not be generated."),
          repairState:
            result.repairState && typeof result.repairState === "object" ? result.repairState : undefined,
        });
      }
    },
    [saveToNotebook, updateArtifactStatus],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function scan() {
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetUrl: sourceDocument.targetUrl, sections: sourceDocument.sections }),
          signal: controller.signal,
        });
        const data = (await response.json()) as { artifacts?: ArtifactDescriptor[]; error?: string };
        if (!response.ok || !data.artifacts) throw new Error(data.error || "The page scan failed.");
        setArtifacts(data.artifacts);
        setScanState("ready");
        for (const descriptor of data.artifacts.slice(0, 3)) {
          void requestArtifact(descriptor, { intent: "prefetch", open: false });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setScanError(error instanceof Error ? error.message : "The page scan failed.");
        setScanState("error");
      }
    }
    void scan();
    return () => controller.abort();
  }, [requestArtifact, sourceDocument.sections, sourceDocument.targetUrl]);

  useEffect(() => {
    const key = notebookStorageKey(sourceDocument.targetUrl);
    try {
      setNotebook(parseNotebook(window.localStorage.getItem(key)));
    } catch {
      setNotebook([]);
    }
    setNotebookLoaded(true);
  }, [sourceDocument.targetUrl]);

  useEffect(() => {
    if (!notebookLoaded) return;
    try {
      window.localStorage.setItem(notebookStorageKey(sourceDocument.targetUrl), JSON.stringify(notebook));
    } catch {
      // Notebook persistence is best-effort when storage is unavailable or full.
    }
  }, [notebook, notebookLoaded, sourceDocument.targetUrl]);

  const closeOverlay = useCallback(() => {
    activeRequestId.current += 1;
    setView(null);
    window.setTimeout(() => restoreFocus.current?.focus({ preventScroll: true }), 0);
  }, []);

  const openArtifact = useCallback(
    (descriptor: ArtifactDescriptor, preserveRestoreFocus = false) => {
      setPrompt(null);
      void requestArtifact(descriptor, {
        intent: "interactive",
        open: true,
        preserveRestoreFocus,
      });
    },
    [requestArtifact],
  );

  const artifactSignature = useMemo(
    () => artifacts.map((artifact) => `${artifact.artifactId}:${artifact.brief.anchor.dom_selector}`).join("|"),
    [artifacts],
  );

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const cleanups: Array<() => void> = [];

    artifacts.forEach((artifact, index) => {
      const element = article.querySelector<HTMLElement>(artifact.brief.anchor.dom_selector);
      if (!element) return;
      const priorTabIndex = element.getAttribute("tabindex");
      const priorLabel = element.getAttribute("aria-label");
      element.classList.add("moire-candidate");
      if (index < 3) element.classList.add("moire-speculative");
      element.dataset.moireStatus = artifact.status;
      element.dataset.moireArtifact = artifact.artifactId;
      element.tabIndex = 0;
      element.setAttribute("aria-label", `${artifact.brief.title}. Press Enter to visualize this passage.`);

      const reveal = () => {
        const position = promptPosition(element.getBoundingClientRect());
        setPrompt({ kind: "artifact", artifactId: artifact.artifactId, ...position });
      };
      const activate = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        restoreFocus.current = element;
        openArtifact(artifact, true);
      };
      element.addEventListener("mouseenter", reveal);
      element.addEventListener("focus", reveal);
      element.addEventListener("keydown", activate);
      cleanups.push(() => {
        element.classList.remove("moire-candidate", "moire-speculative", "moire-flash");
        delete element.dataset.moireStatus;
        delete element.dataset.moireArtifact;
        if (priorTabIndex === null) element.removeAttribute("tabindex");
        else element.setAttribute("tabindex", priorTabIndex);
        if (priorLabel === null) element.removeAttribute("aria-label");
        else element.setAttribute("aria-label", priorLabel);
        element.removeEventListener("mouseenter", reveal);
        element.removeEventListener("focus", reveal);
        element.removeEventListener("keydown", activate);
      });
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [artifactSignature, openArtifact]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    artifacts.forEach((artifact) => {
      const element = article.querySelector<HTMLElement>(artifact.brief.anchor.dom_selector);
      if (element) element.dataset.moireStatus = artifact.status;
    });
  }, [artifacts]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const captureSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 1800);
      if (text.length < 12) return;
      const range = selection.getRangeAt(0);
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const element = start?.closest<HTMLElement>('[id^="p-"]');
      if (!element || !article.contains(element)) return;
      const selector = `#${element.id}` as `#p-${number}`;
      const position = promptPosition(range.getBoundingClientRect().width ? range.getBoundingClientRect() : element.getBoundingClientRect());
      const source = sourceDocument.sections.find((section) => section.selector === selector);
      if (!source) return;
      setPrompt({ kind: "selection", section: { ...source, text }, ...position });
    };
    article.addEventListener("mouseup", captureSelection);
    article.addEventListener("keyup", captureSelection);
    return () => {
      article.removeEventListener("mouseup", captureSelection);
      article.removeEventListener("keyup", captureSelection);
    };
  }, [artifacts, sourceDocument.sections]);

  useEffect(() => {
    const dismiss = () => setPrompt(null);
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".anchor-prompt,.moire-candidate")) return;
      setPrompt(null);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.document.addEventListener("pointerdown", dismissOutside);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.document.removeEventListener("pointerdown", dismissOutside);
    };
  }, []);

  const scanSelection = useCallback(
    async (section: ScanSection) => {
      setPrompt(null);
      restoreFocus.current = window.document.activeElement as HTMLElement | null;
      setView({
        status: "loading",
        title: section.section || "Selected passage",
        message: "Finding an interactive angle…",
        detail: "The fast scanner is turning this selection into a bounded visualization brief.",
      });
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetUrl: sourceDocument.targetUrl, selection: true, sections: [section] }),
        });
        const data = (await response.json()) as { artifacts?: ArtifactDescriptor[]; error?: string };
        if (!response.ok || !data.artifacts) throw new Error(data.error || "The selected passage could not be scanned.");
        const descriptor = data.artifacts[0];
        if (!descriptor) throw new Error("This selection did not yield a useful interactive view.");
        setArtifacts((current) => [...current.filter((artifact) => artifact.artifactId !== descriptor.artifactId), descriptor]);
        openArtifact(descriptor, true);
      } catch (error) {
        setView({
          status: "error",
          title: section.section || "Selected passage",
          message: error instanceof Error ? error.message : "The selected passage could not be visualized.",
        });
      }
    },
    [openArtifact, sourceDocument.targetUrl],
  );

  const handleRuntimeFailure = useCallback(
    (message: string) => {
      if (view?.status !== "ready") return;
      resultCache.current.delete(view.descriptor.artifactId);
      void requestArtifact(view.descriptor, {
        intent: "interactive",
        open: true,
        runtimeError: message,
        preserveRestoreFocus: true,
      });
    },
    [requestArtifact, view],
  );

  const openNotebookEntry = useCallback(
    (entry: NotebookEntry) => {
      const current =
        artifacts.find((artifact) => artifact.artifactId === entry.artifactId) ??
        artifacts.find((artifact) => artifact.brief.anchor.dom_selector === entry.brief.anchor.dom_selector);
      openArtifact(
        current ?? { artifactId: entry.artifactId, brief: entry.brief, status: "idle" },
      );
    },
    [artifacts, openArtifact],
  );

  const revealNotebookSource = useCallback(
    (entry: NotebookEntry) => {
      const element = articleRef.current?.querySelector<HTMLElement>(entry.brief.anchor.dom_selector);
      if (!element) return;
      setPrompt(null);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        element.focus({ preventScroll: true });
        element.classList.add("moire-flash");
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => element.classList.remove("moire-flash"), 1300);
      }, 350);
    },
    [],
  );

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const promptArtifact = useMemo(
    () => (prompt?.kind === "artifact" ? artifacts.find((artifact) => artifact.artifactId === prompt.artifactId) : undefined),
    [artifacts, prompt],
  );
  const articleMarkup = useMemo(() => ({ __html: sourceDocument.html }), [sourceDocument.html]);

  const promptLabel = promptArtifact
    ? promptArtifact.status === "ready"
      ? "Visualize?"
      : promptArtifact.status === "generating" || promptArtifact.status === "repairing"
        ? "Open when ready"
        : promptArtifact.status === "error"
          ? "View diagnostic"
          : "Generate view"
    : "Visualize selection?";

  return (
    <div className="reader-page">
      <header className="reader-bar">
        <a className="wordmark" href="/">Moiré <span>β</span></a>
        <div className="source-address" title={sourceDocument.targetUrl}>{sourceDocument.targetUrl}</div>
        <a className="source-link" href={sourceDocument.targetUrl} target="_blank" rel="noreferrer">Original ↗</a>
      </header>

      <main className="reader-grid">
        <article className="paper-pane">
          <header className="paper-meta">
            <p>{sourceDocument.siteName}</p>
            <h1>{sourceDocument.title}</h1>
            {sourceDocument.byline ? <span>{sourceDocument.byline}</span> : null}
          </header>
          <div className="reader-article" ref={articleRef} dangerouslySetInnerHTML={articleMarkup} />
        </article>

        <NotebookRail
          scanState={scanState}
          scanError={scanError}
          artifacts={artifacts}
          entries={notebook}
          onOpen={openNotebookEntry}
          onRevealSource={revealNotebookSource}
        />
      </main>

      {prompt ? (
        <div className={`anchor-prompt is-${prompt.kind}`} style={{ top: prompt.top, left: prompt.left }}>
          <span>{prompt.kind === "selection" ? "Selected passage" : promptArtifact?.brief.viz_kind.replace("-", " ")}</span>
          <strong>{prompt.kind === "selection" ? prompt.section.text.slice(0, 72) : promptArtifact?.brief.title}</strong>
          <button
            type="button"
            onClick={() => {
              if (prompt.kind === "selection") void scanSelection(prompt.section);
              else if (promptArtifact) openArtifact(promptArtifact);
            }}
          >
            {promptLabel} <i aria-hidden="true">↗</i>
          </button>
        </div>
      ) : null}

      {view ? (
        <ArtifactOverlay
          view={view}
          onClose={closeOverlay}
          onMinimize={() => {
            if (view.status === "ready") saveToNotebook(view.descriptor);
            closeOverlay();
          }}
          onRuntimeFailure={handleRuntimeFailure}
        />
      ) : null}
    </div>
  );
}
