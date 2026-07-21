"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InlineExperiment, type ArtifactView } from "@/components/inline-experiment";
import { NotebookPanel, type NotebookStyle } from "@/components/notebook-panel";
import {
  addNotebookEntry,
  notebookSelectionSection,
  notebookStorageKey,
  parseNotebook,
  resolveNotebookArtifact,
  type NotebookEntry,
} from "@/lib/notebook";
import {
  assessSelection,
  selectionContextForStoredSection,
  warningForFocusStatus,
  type SelectionContext,
  type SelectionFocusAssessment,
  type SelectionPolicyResult,
} from "@/lib/selection-policy";
import { collectSelectionContext } from "@/lib/selection-context";
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
  | {
      kind: "selection";
      section: ScanSection;
      context: SelectionContext;
      policy: SelectionPolicyResult;
      top: number;
      left: number;
    };

type ArtifactRequestOptions = {
  intent: "interactive" | "prefetch";
  open: boolean;
  runtimeError?: string;
  preserveRestoreFocus?: boolean;
  recoverNotFound?: boolean;
};

type ArtifactRequestOutcome = "complete" | "not-found" | "failed";

type ScanState = "loading" | "ready" | "error" | "paused";

function promptPosition(rect: DOMRect): { top: number; left: number } {
  const width = 230;
  const left = rect.right + width + 20 < window.innerWidth ? rect.right + 12 : Math.max(12, rect.right - width);
  return { top: Math.max(76, Math.min(window.innerHeight - 120, rect.top - 8)), left };
}

function responseMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

function hydrateReadyDescriptor(
  cache: Map<string, StoredArtifact>,
  descriptor: ArtifactDescriptor,
  readyArtifacts: CachedArtifactResult[] = [],
): ArtifactDescriptor {
  const result = readyArtifacts.find((candidate) => candidate.artifactId === descriptor.artifactId);
  if (result?.ok === true && typeof result.html === "string" && result.repairState) {
    cache.set(descriptor.artifactId, { html: result.html, repairState: result.repairState });
  }
  return descriptor.status === "ready" && !cache.has(descriptor.artifactId)
    ? { ...descriptor, status: "idle" }
    : descriptor;
}

type SpineMark = {
  id: string;
  pct: number;
  title: string;
  status: ArtifactStatus;
  selector: string;
};

function ExperimentSpine({
  articleRef,
  artifacts,
  scanState,
  scanError,
  openAnchor,
}: {
  articleRef: React.RefObject<HTMLDivElement | null>;
  artifacts: ArtifactDescriptor[];
  scanState: ScanState;
  scanError: string;
  openAnchor: string | null;
}) {
  const bandRef = useRef<HTMLSpanElement>(null);
  const [marks, setMarks] = useState<SpineMark[]>([]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const measure = () => {
      const docHeight = window.document.documentElement.scrollHeight;
      if (!docHeight) return;
      setMarks(
        artifacts.flatMap((artifact) => {
          const element = article.querySelector<HTMLElement>(artifact.brief.anchor.dom_selector);
          if (!element) return [];
          const pct = ((element.getBoundingClientRect().top + window.scrollY) / docHeight) * 100;
          return [
            {
              id: artifact.artifactId,
              pct: Math.min(98, Math.max(1, pct)),
              title: artifact.brief.title,
              status: artifact.status,
              selector: artifact.brief.anchor.dom_selector,
            },
          ];
        }),
      );
    };
    measure();
    // ponytail: one delayed re-measure absorbs late image/math layout shifts; use a ResizeObserver if it misses.
    const timer = window.setTimeout(measure, 1500);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [articleRef, artifacts, openAnchor]);

  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const docHeight = window.document.documentElement.scrollHeight;
      if (!docHeight) return;
      band.style.top = `${(window.scrollY / docHeight) * 100}%`;
      band.style.height = `${(window.innerHeight / docHeight) * 100}%`;
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const readyCount = artifacts.filter((artifact) => artifact.status === "ready").length;
  const label =
    scanState === "loading"
      ? "Scanning source"
      : scanState === "error"
        ? "Scan stopped"
        : scanState === "paused"
          ? "AI paused · layout only"
          : artifacts.length === 0
            ? "No experiments found"
            : openAnchor
              ? `1 open · ${readyCount} ready`
              : readyCount > 0
                ? `${readyCount} of ${artifacts.length} ready`
                : `${artifacts.length} experiment${artifacts.length === 1 ? "" : "s"}`;

  const jump = (selector: string) => {
    const element = articleRef.current?.querySelector<HTMLElement>(selector);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.focus({ preventScroll: true });
  };

  return (
    <nav className="experiment-spine" aria-label="Experiments in this source">
      <span
        className={`spine-label${scanState === "error" ? " is-error" : ""}`}
        title={scanState === "error" ? scanError : undefined}
      >
        {label.toUpperCase()}
      </span>
      <div className="spine-track">
        <span className="spine-band" ref={bandRef} aria-hidden="true" />
        {marks.map((mark) => (
          <button
            key={mark.id}
            type="button"
            className={`spine-mark${mark.selector === openAnchor ? " is-open" : ""}`}
            data-status={mark.status}
            style={{ top: `${mark.pct}%` }}
            title={mark.title}
            aria-label={`Go to passage: ${mark.title}`}
            onClick={() => jump(mark.selector)}
          />
        ))}
      </div>
    </nav>
  );
}

export function ReaderShell({
  document: sourceDocument,
  aiEnabled = true,
  prefetchEnabled = true,
}: {
  document: IngestedDocument;
  aiEnabled?: boolean;
  prefetchEnabled?: boolean;
}) {
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);
  const [scanState, setScanState] = useState<ScanState>(aiEnabled ? "loading" : "paused");
  const [scanError, setScanError] = useState("");
  const [view, setView] = useState<ArtifactView | null>(null);
  const [prompt, setPrompt] = useState<AnchorPrompt | null>(null);
  const [notebook, setNotebook] = useState<NotebookEntry[]>([]);
  const [notebookLoaded, setNotebookLoaded] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookStyle, setNotebookStyle] = useState<NotebookStyle>("dock");
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const [awayFromOpen, setAwayFromOpen] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);
  const resultCache = useRef(new Map<string, StoredArtifact>());
  const activeRequestId = useRef(0);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  const selectionScanAbort = useRef<AbortController | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const collapsing = useRef(false);

  const updateArtifactStatus = useCallback((artifactId: string, status: ArtifactStatus) => {
    setArtifacts((current) =>
      current.map((artifact) => (artifact.artifactId === artifactId ? { ...artifact, status } : artifact)),
    );
  }, []);

  const saveToNotebook = useCallback((descriptor: ArtifactDescriptor) => {
    setNotebook((current) =>
      addNotebookEntry(current, {
        artifactId: descriptor.artifactId,
        kind: descriptor.kind,
        brief: descriptor.brief,
        savedAt: Date.now(),
      }),
    );
  }, []);

  const requestArtifact = useCallback(
    async (descriptor: ArtifactDescriptor, options: ArtifactRequestOptions): Promise<ArtifactRequestOutcome> => {
      const anchor = descriptor.brief.anchor.dom_selector;
      if (!aiEnabled) {
        if (options.open) {
          setView({
            status: "error",
            anchor,
            title: descriptor.brief.title,
            descriptor,
            message: "AI requests are paused for this local QA server.",
          });
        }
        return "failed";
      }
      const local = !options.runtimeError ? resultCache.current.get(descriptor.artifactId) : undefined;
      if (local) {
        if (options.open) {
          if (!options.preserveRestoreFocus) restoreFocus.current = window.document.activeElement as HTMLElement | null;
          setView({ status: "ready", anchor, descriptor, html: local.html, repairState: local.repairState, cached: true });
        }
        updateArtifactStatus(descriptor.artifactId, "ready");
        return "complete";
      }

      const requestId = options.open ? activeRequestId.current + 1 : 0;
      if (options.open) {
        activeRequestId.current = requestId;
        if (!options.preserveRestoreFocus) restoreFocus.current = window.document.activeElement as HTMLElement | null;
        setView({
          status: "loading",
          anchor,
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
            anchor,
            title: descriptor.brief.title,
            descriptor,
            message: error instanceof Error ? error.message : "The visualization request could not be completed.",
          });
        }
        return "failed";
      }

      const result = data as Partial<CachedArtifactResult>;
      if (response.ok && result.ok === true && typeof result.html === "string" && result.repairState) {
        resultCache.current.set(descriptor.artifactId, { html: result.html, repairState: result.repairState });
        updateArtifactStatus(descriptor.artifactId, "ready");
        if (options.open && requestId === activeRequestId.current) {
          setView({
            status: "ready",
            anchor,
            descriptor: { ...descriptor, status: "ready" },
            html: result.html,
            repairState: result.repairState,
            cached: result.cached === true || options.intent === "prefetch",
          });
        }
        return "complete";
      }

      if (response.status === 404 && options.recoverNotFound) {
        updateArtifactStatus(descriptor.artifactId, "idle");
        return "not-found";
      }
      const terminal = response.status === 422;
      updateArtifactStatus(descriptor.artifactId, terminal ? "error" : "idle");
      if (options.open && requestId === activeRequestId.current) {
        setView({
          status: "error",
          anchor,
          title: descriptor.brief.title,
          descriptor,
          message: responseMessage(data, "The visualization could not be generated."),
          repairState:
            result.repairState && typeof result.repairState === "object" ? result.repairState : undefined,
        });
      }
      return "failed";
    },
    [aiEnabled, updateArtifactStatus],
  );

  useEffect(() => {
    if (!aiEnabled) {
      setScanState("paused");
      return;
    }
    const controller = new AbortController();
    async function scan() {
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetUrl: sourceDocument.targetUrl, sections: sourceDocument.sections }),
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          artifacts?: ArtifactDescriptor[];
          readyArtifacts?: CachedArtifactResult[];
          error?: string;
        };
        if (!response.ok || !data.artifacts) throw new Error(data.error || "The page scan failed.");
        const browserArtifacts = data.artifacts.map((descriptor) =>
          hydrateReadyDescriptor(resultCache.current, descriptor, data.readyArtifacts),
        );
        setArtifacts(browserArtifacts);
        setScanState("ready");
        if (prefetchEnabled) {
          for (const descriptor of browserArtifacts.slice(0, 3)) {
            if (resultCache.current.has(descriptor.artifactId)) continue;
            void requestArtifact(descriptor, { intent: "prefetch", open: false });
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setScanError(error instanceof Error ? error.message : "The page scan failed.");
        setScanState("error");
      }
    }
    void scan();
    return () => controller.abort();
  }, [aiEnabled, prefetchEnabled, requestArtifact, sourceDocument.sections, sourceDocument.targetUrl]);

  useEffect(() => {
    const key = notebookStorageKey(sourceDocument.targetUrl);
    try {
      setNotebook(parseNotebook(window.localStorage.getItem(key)));
    } catch {
      setNotebook([]);
    }
    setNotebookLoaded(true);
    const stored = window.localStorage.getItem("moire:notebook-style");
    if (stored === "rail" || stored === "dock") setNotebookStyle(stored);
  }, [sourceDocument.targetUrl]);

  useEffect(() => {
    if (!notebookLoaded) return;
    try {
      window.localStorage.setItem(notebookStorageKey(sourceDocument.targetUrl), JSON.stringify(notebook));
    } catch {
      // Notebook persistence is best-effort when storage is unavailable or full.
    }
  }, [notebook, notebookLoaded, sourceDocument.targetUrl]);

  const changeNotebookStyle = useCallback((style: NotebookStyle) => {
    setNotebookStyle(style);
    try {
      window.localStorage.setItem("moire:notebook-style", style);
    } catch {
      // Style preference persistence is best-effort.
    }
  }, []);

  // Collapse reverses the expand and restores geometry exactly; 0s under reduced motion.
  const closeView = useCallback(() => {
    if (collapsing.current) return;
    activeRequestId.current += 1;
    selectionScanAbort.current?.abort();
    selectionScanAbort.current = null;
    const slot = slotRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      collapsing.current = false;
      setView(null);
      window.setTimeout(() => restoreFocus.current?.focus({ preventScroll: true }), 0);
    };
    if (slot && !reduced) {
      collapsing.current = true;
      slot.classList.remove("is-open");
      window.setTimeout(finish, 240);
    } else {
      finish();
    }
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

  // The inline slot: one element inserted after the anchor passage, one reflow per expand.
  const anchorSelector = view?.anchor ?? null;
  useEffect(() => {
    if (!anchorSelector) {
      slotRef.current = null;
      setSlotEl(null);
      return;
    }
    const article = articleRef.current;
    if (!article) return;
    const target = article.querySelector<HTMLElement>(anchorSelector);
    const container = window.document.createElement("div");
    container.className = "moire-inline-slot";
    if (target) {
      target.insertAdjacentElement("afterend", container);
      target.dataset.moireOpen = "true";
    } else {
      article.appendChild(container);
    }
    slotRef.current = container;
    setSlotEl(container);
    const raf = window.requestAnimationFrame(() => container.classList.add("is-open"));
    return () => {
      window.cancelAnimationFrame(raf);
      container.remove();
      if (target) delete target.dataset.moireOpen;
      if (slotRef.current === container) slotRef.current = null;
      setSlotEl((current) => (current === container ? null : current));
    };
  }, [anchorSelector]);

  useEffect(() => {
    if (!view) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeView();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, closeView]);

  // Failure case 5a: scrolled away while an experiment is open → quiet return chip.
  useEffect(() => {
    if (!slotEl) {
      setAwayFromOpen(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setAwayFromOpen(!entry.isIntersecting));
    observer.observe(slotEl);
    return () => observer.disconnect();
  }, [slotEl]);

  const artifactSignature = useMemo(
    () => artifacts.map((artifact) => `${artifact.artifactId}:${artifact.brief.anchor.dom_selector}`).join("|"),
    [artifacts],
  );

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !aiEnabled) return;
    const cleanups: Array<() => void> = [];

    artifacts.forEach((artifact) => {
      const element = article.querySelector<HTMLElement>(artifact.brief.anchor.dom_selector);
      if (!element) return;
      const priorTabIndex = element.getAttribute("tabindex");
      const priorLabel = element.getAttribute("aria-label");
      element.classList.add("moire-candidate");
      element.dataset.moireStatus = artifact.status;
      element.dataset.moireArtifact = artifact.artifactId;
      element.tabIndex = 0;
      element.setAttribute("aria-label", `${artifact.brief.title}. Press Enter to visualize this passage.`);

      const reveal = () => {
        const position = promptPosition(element.getBoundingClientRect());
        setPrompt({ kind: "artifact", artifactId: artifact.artifactId, ...position });
      };
      const activate = (event: KeyboardEvent) => {
        if (event.target !== element) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        restoreFocus.current = element;
        openArtifact(artifact, true);
      };
      element.addEventListener("mouseenter", reveal);
      element.addEventListener("focus", reveal);
      element.addEventListener("keydown", activate);
      cleanups.push(() => {
        element.classList.remove("moire-candidate", "moire-flash");
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
      const range = selection.getRangeAt(0);
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const element = start?.closest<HTMLElement>('[id^="p-"]');
      const structural = collectSelectionContext(range, article, sourceDocument.sections, selection.toString());
      const text = structural.text;
      const selector =
        structural.source?.selector ??
        (element && article.contains(element) ? (`#${element.id}` as `#p-${number}`) : undefined);
      if (!selector) return;
      const rangeRect = range.getBoundingClientRect();
      const fallbackElement = article.querySelector<HTMLElement>(selector);
      if (!fallbackElement) return;
      const position = promptPosition(rangeRect.width ? rangeRect : fallbackElement.getBoundingClientRect());
      const source = sourceDocument.sections.find((section) => section.selector === selector) ?? structural.source;
      if (!source) return;
      const policy = assessSelection(text, structural.context);
      setPrompt({ kind: "selection", section: { ...source, text }, context: structural.context, policy, ...position });
    };
    article.addEventListener("mouseup", captureSelection);
    article.addEventListener("keyup", captureSelection);
    return () => {
      article.removeEventListener("mouseup", captureSelection);
      article.removeEventListener("keyup", captureSelection);
    };
  }, [aiEnabled, artifacts, sourceDocument.sections]);

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
    async (selectionPrompt: Extract<AnchorPrompt, { kind: "selection" }>) => {
      if (!aiEnabled) return;
      const { section, context, top, left } = selectionPrompt;
      const sourceElement = articleRef.current?.querySelector<HTMLElement>(section.selector);
      restoreFocus.current = sourceElement ?? null;
      setPrompt(null);
      selectionScanAbort.current?.abort();
      const controller = new AbortController();
      selectionScanAbort.current = controller;
      const requestId = activeRequestId.current + 1;
      activeRequestId.current = requestId;
      setView({
        status: "loading",
        anchor: section.selector,
        title: section.section || "Selected passage",
        message: "Finding an interactive angle…",
        detail: "The fast scanner is turning this selection into a bounded visualization brief.",
      });
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetUrl: sourceDocument.targetUrl,
            selection: true,
            selectionContext: context,
            sections: [section],
          }),
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          artifacts?: ArtifactDescriptor[];
          readyArtifacts?: CachedArtifactResult[];
          selectionAssessment?: SelectionFocusAssessment;
          error?: string;
        };
        if (controller.signal.aborted || requestId !== activeRequestId.current) return;
        if (!response.ok || !data.artifacts) throw new Error(data.error || "The selected passage could not be scanned.");
        if (data.selectionAssessment && data.selectionAssessment.status !== "sufficient") {
          setView(null);
          setPrompt({
            ...selectionPrompt,
            top,
            left,
            policy: warningForFocusStatus(data.selectionAssessment.status),
          });
          return;
        }
        const scanned = data.artifacts[0];
        if (!scanned) {
          setView(null);
          setPrompt({ ...selectionPrompt, top, left, policy: warningForFocusStatus("too_narrow") });
          return;
        }
        openArtifact(hydrateReadyDescriptor(resultCache.current, scanned, data.readyArtifacts), true);
      } catch (error) {
        if (controller.signal.aborted || requestId !== activeRequestId.current) return;
        setView({
          status: "error",
          anchor: section.selector,
          title: section.section || "Selected passage",
          message: error instanceof Error ? error.message : "The selected passage could not be visualized.",
        });
      } finally {
        if (selectionScanAbort.current === controller) selectionScanAbort.current = null;
      }
    },
    [aiEnabled, openArtifact, sourceDocument.targetUrl],
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
    async (entry: NotebookEntry) => {
      const resolved = resolveNotebookArtifact(entry, artifacts);
      setPrompt(null);
      const outcome = await requestArtifact(resolved, {
        intent: "interactive",
        open: true,
        recoverNotFound: entry.kind === "selection",
      });
      if (outcome !== "not-found") return;

      const section = notebookSelectionSection(entry);
      if (!section) return;
      const requestId = activeRequestId.current;
      setView({
        status: "loading",
        anchor: resolved.brief.anchor.dom_selector,
        title: entry.brief.title,
        descriptor: resolved,
        message: "Rebuilding this saved selection…",
        detail: "Its server cache entry expired, so Moiré is registering the selected passage again.",
      });
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetUrl: sourceDocument.targetUrl,
            selection: true,
            selectionContext: selectionContextForStoredSection(section),
            sections: [section],
          }),
        });
        const data = (await response.json()) as {
          artifacts?: ArtifactDescriptor[];
          readyArtifacts?: CachedArtifactResult[];
          error?: string;
        };
        if (requestId !== activeRequestId.current) return;
        if (!response.ok || !data.artifacts?.[0]) {
          throw new Error(data.error || "The saved selection could not be registered again.");
        }
        const replacement = hydrateReadyDescriptor(resultCache.current, data.artifacts[0], data.readyArtifacts);
        setNotebook((current) =>
          current.map((candidate) =>
            candidate.artifactId === entry.artifactId
              ? { ...candidate, artifactId: replacement.artifactId, brief: replacement.brief }
              : candidate,
          ),
        );
        await requestArtifact(replacement, {
          intent: "interactive",
          open: true,
          preserveRestoreFocus: true,
        });
      } catch (error) {
        if (requestId !== activeRequestId.current) return;
        setView({
          status: "error",
          anchor: resolved.brief.anchor.dom_selector,
          title: entry.brief.title,
          descriptor: resolved,
          message: error instanceof Error ? error.message : "The saved selection could not be rebuilt.",
        });
      }
    },
    [artifacts, requestArtifact, sourceDocument.targetUrl],
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
        flashTimer.current = window.setTimeout(() => element.classList.remove("moire-flash"), 2000);
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
  const isArxivHtml = sourceDocument.siteName.startsWith("arXiv");

  const promptLabel = promptArtifact
    ? promptArtifact.status === "ready"
      ? "Visualize?"
      : promptArtifact.status === "generating" || promptArtifact.status === "repairing"
        ? "Open when ready"
        : promptArtifact.status === "error"
          ? "View diagnostic"
          : "Generate view"
    : "Visualize selection?";

  const viewDescriptor = view && "descriptor" in view ? view.descriptor : undefined;
  const pinned =
    view?.status === "ready" && notebook.some((entry) => entry.artifactId === view.descriptor.artifactId);
  const awaySection = viewDescriptor?.brief.anchor.section || (view?.status !== "ready" ? view?.title : "");

  return (
    <div className={`reader-page${notebookOpen && notebookStyle === "rail" ? " nb-rail-open" : ""}`}>
      <div className="reader-top">
        <div className="top-hairline" aria-hidden="true" />
        <header className="source-bar">
          <a className="wordmark" href="/">Moiré <span>β</span></a>
          <div className="source-address" title={sourceDocument.targetUrl}>{sourceDocument.targetUrl}</div>
          <a className="source-link" href={sourceDocument.targetUrl} target="_blank" rel="noreferrer">Original ↗</a>
        </header>
      </div>

      <ExperimentSpine
        articleRef={articleRef}
        artifacts={artifacts}
        scanState={scanState}
        scanError={scanError}
        openAnchor={anchorSelector}
      />

      <main className="reader-main">
        <article className={`paper-pane${isArxivHtml ? " is-arxiv" : ""}`}>
          {!isArxivHtml ? (
            <header className="paper-meta">
              <p>{sourceDocument.siteName}</p>
              <h1>{sourceDocument.title}</h1>
              {sourceDocument.byline ? <span>{sourceDocument.byline}</span> : null}
            </header>
          ) : null}
          <div
            className={`reader-article${isArxivHtml ? " is-arxiv" : ""}`}
            ref={articleRef}
            dangerouslySetInnerHTML={articleMarkup}
          />
        </article>
      </main>

      <NotebookPanel
        entries={notebook}
        open={notebookOpen}
        style={notebookStyle}
        onToggle={() => setNotebookOpen((current) => !current)}
        onStyleChange={changeNotebookStyle}
        onOpenEntry={openNotebookEntry}
        onRevealSource={revealNotebookSource}
      />

      {prompt ? (
        <div
          className={`anchor-prompt is-${prompt.kind}${prompt.kind === "selection" ? ` is-${prompt.policy.status}` : ""}`}
          style={{ top: prompt.top, left: prompt.left }}
          aria-live="polite"
        >
          <span>
            {prompt.kind === "selection"
              ? prompt.policy.status === "too_narrow"
                ? "Selection needs context"
                : prompt.policy.status === "too_broad"
                  ? "Selection spans multiple concepts"
                  : "Selected passage"
              : promptArtifact?.brief.viz_kind.replace("-", " ")}
          </span>
          <strong>
            {prompt.kind === "selection"
              ? prompt.policy.status === "eligible"
                ? prompt.section.text.slice(0, 72)
                : prompt.policy.message
              : promptArtifact?.brief.title}
          </strong>
          {prompt.kind !== "selection" || prompt.policy.status === "eligible" ? (
            <button
              type="button"
              onClick={() => {
                if (prompt.kind === "selection") void scanSelection(prompt);
                else if (promptArtifact) {
                  restoreFocus.current =
                    articleRef.current?.querySelector<HTMLElement>(promptArtifact.brief.anchor.dom_selector) ?? null;
                  openArtifact(promptArtifact, true);
                }
              }}
            >
              {promptLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {view && awayFromOpen ? (
        <div className="return-chip">
          <i aria-hidden="true" />
          <span>Experiment open{awaySection ? ` in ${awaySection}` : ""} —</span>
          <button
            type="button"
            onClick={() => slotRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
          >
            Return ↑
          </button>
        </div>
      ) : null}

      {view && slotEl
        ? createPortal(
            <InlineExperiment
              view={view}
              pinned={pinned}
              onPin={() => {
                if (view.status !== "ready") return;
                saveToNotebook(view.descriptor);
                setNotebookOpen(true);
              }}
              onCollapse={closeView}
              onRetry={
                view.status === "error" && view.descriptor
                  ? () => {
                      const descriptor = view.descriptor;
                      if (descriptor) {
                        void requestArtifact(descriptor, {
                          intent: "interactive",
                          open: true,
                          preserveRestoreFocus: true,
                        });
                      }
                    }
                  : undefined
              }
              onRuntimeFailure={handleRuntimeFailure}
            />,
            slotEl,
          )
        : null}
    </div>
  );
}
