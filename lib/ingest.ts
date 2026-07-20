import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { extractArxivId } from "@/lib/target";
import { safeFetchHtml } from "@/lib/safe-fetch";
import type { IngestedDocument, ScanSection } from "@/lib/types";

export const ARXIV_ERROR = "paper not available in HTML form — try another arXiv ID";
export const READABILITY_ERROR = "couldn't extract readable content from this URL";

const BLOCK_SELECTOR = "article,section,div,p,h1,h2,h3,h4,h5,h6,figure,figcaption,blockquote,pre,li,table";
const CANDIDATE_SELECTOR =
  "h1,h2,h3,h4,p,figure,figcaption,blockquote,pre,li,table,[class*='equation'],[class*='formula']";
const REMOVE_SELECTOR =
  "script,noscript,iframe,object,embed,link,style,meta,base,form,input,button,textarea,select,option,video,audio,source,track,foreignObject,animate,set";

export class IngestError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

function safeAbsoluteUrl(value: string, baseUrl: string): string | null {
  if (!value || value.startsWith("#")) return value;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sectionLabel(element: Element): string {
  if (/^H[1-4]$/.test(element.tagName)) return element.textContent?.trim().slice(0, 120) || "Untitled section";
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (/^H[1-4]$/.test(sibling.tagName)) return sibling.textContent?.trim().slice(0, 120) || "Untitled section";
    sibling = sibling.previousElementSibling;
  }
  const parentHeading = element.parentElement?.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");
  return parentHeading?.textContent?.trim().slice(0, 120) || "Paper";
}

function elementType(element: Element): ScanSection["elementType"] {
  if (element.matches("figure,figcaption") || element.querySelector("img,svg")) return "figure";
  if (element.matches("[class*='equation'],[class*='formula']") || element.querySelector("math")) return "equation";
  return element.matches("p,li") ? "sentence" : "paragraph";
}

export function sanitizeAndIndex(html: string, baseUrl: string): { html: string; sections: ScanSection[]; title: string } {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: baseUrl });
  const { document } = dom.window;

  document.querySelectorAll(REMOVE_SELECTOR).forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        ["srcdoc", "nonce", "style", "srcset", "ping", "background", "autofocus", "contenteditable", "tabindex", "aria-modal"].includes(name)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const name of ["href", "src", "poster", "cite", "xlink:href"]) {
      if (!element.hasAttribute(name)) continue;
      const safe = safeAbsoluteUrl(element.getAttribute(name) ?? "", baseUrl);
      if (safe === null) element.removeAttribute(name);
      else element.setAttribute(name, safe);
    }
    if (element.tagName === "A") {
      element.setAttribute("rel", "noreferrer noopener");
      element.setAttribute("target", "_blank");
    }
  });

  let index = 0;
  const sourceIds = new Map<string, string>();
  document.querySelectorAll(BLOCK_SELECTOR).forEach((element) => {
    index += 1;
    const stableId = `p-${index}`;
    if (element.id) {
      element.setAttribute("data-source-id", element.id);
      if (!sourceIds.has(element.id)) sourceIds.set(element.id, stableId);
    }
    element.id = stableId;
  });
  document.querySelectorAll<HTMLAnchorElement>("a[href^='#']").forEach((anchor) => {
    const fragment = anchor.getAttribute("href")?.slice(1) ?? "";
    const stableId = sourceIds.get(fragment);
    if (stableId) anchor.setAttribute("href", `#${stableId}`);
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  });

  const seen = new Set<string>();
  const sections: ScanSection[] = [];
  document.querySelectorAll(CANDIDATE_SELECTOR).forEach((candidate) => {
    const anchor = candidate.id ? candidate : candidate.closest(BLOCK_SELECTOR);
    if (!anchor?.id.match(/^p-\d+$/) || seen.has(anchor.id)) return;
    const visibleText = (candidate.textContent ?? "").replace(/\s+/g, " ").trim();
    const imageText = candidate.querySelector("img")?.getAttribute("alt")?.replace(/\s+/g, " ").trim() ?? "";
    const text = (visibleText || imageText).slice(0, 1800);
    if (!text) return;
    if (text.length < 40 && !candidate.matches("figure,[class*='equation'],[class*='formula']")) return;
    seen.add(anchor.id);
    sections.push({
      selector: `#${anchor.id}` as `#p-${number}`,
      section: sectionLabel(candidate),
      elementType: elementType(candidate),
      text,
    });
  });

  document.querySelectorAll("[class]").forEach((element) => element.removeAttribute("class"));

  const title = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || "Untitled page";
  return { html: document.body.innerHTML, sections, title };
}

async function ingestArxiv(targetUrl: string, arxivId: string): Promise<IngestedDocument> {
  try {
    const sourceUrl = `https://ar5iv.labs.arxiv.org/html/${arxivId}`;
    const { html, finalUrl } = await safeFetchHtml(sourceUrl);
    if (new URL(finalUrl).hostname.toLowerCase() !== "ar5iv.labs.arxiv.org") {
      throw new Error("ar5iv did not provide an HTML rendering");
    }
    const sourceDom = new JSDOM(html, { url: sourceUrl });
    const article = sourceDom.window.document.querySelector("article") ?? sourceDom.window.document.body;
    const indexed = sanitizeAndIndex(article.innerHTML, sourceUrl);
    if (indexed.sections.length === 0) throw new Error("No readable sections");
    return {
      targetUrl,
      title: indexed.title,
      siteName: "arXiv · ar5iv HTML",
      html: indexed.html,
      sections: indexed.sections,
    };
  } catch {
    throw new IngestError(ARXIV_ERROR);
  }
}

async function ingestReadablePage(targetUrl: string): Promise<IngestedDocument> {
  try {
    const { html, finalUrl } = await safeFetchHtml(targetUrl);
    const sourceDom = new JSDOM(html, { url: finalUrl });
    const article = new Readability(sourceDom.window.document, { charThreshold: 500 }).parse();
    if (!article || !article.content || (article.textContent?.trim().length ?? 0) < 500) {
      throw new Error("Readability returned too little content");
    }
    const indexed = sanitizeAndIndex(article.content, finalUrl);
    return {
      targetUrl: finalUrl,
      title: article.title || indexed.title,
      byline: article.byline || undefined,
      siteName: article.siteName || new URL(finalUrl).hostname,
      html: indexed.html,
      sections: indexed.sections,
    };
  } catch {
    throw new IngestError(READABILITY_ERROR);
  }
}

export async function ingestTarget(targetUrl: string): Promise<IngestedDocument> {
  const arxivId = extractArxivId(targetUrl);
  return arxivId ? ingestArxiv(targetUrl, arxivId) : ingestReadablePage(targetUrl);
}
