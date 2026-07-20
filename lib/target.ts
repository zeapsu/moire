const MODERN_ARXIV_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const LEGACY_ARXIV_ID = /^[a-z][a-z0-9.-]*\/\d{7}(?:v\d+)?$/i;

function isArxivId(value: string): boolean {
  return MODERN_ARXIV_ID.test(value) || LEGACY_ARXIV_ID.test(value);
}

export class TargetError extends Error {}

export function normalizeTarget(rawTarget: string): string {
  let value = rawTarget.trim();
  if (!value) throw new TargetError("Enter a URL or arXiv ID.");

  value = value.replace(/^(https?)%3a/i, "$1:");
  value = value.replace(/^(https?):\/(?!\/)/i, "$1://");

  if (isArxivId(value)) {
    return `https://arxiv.org/abs/${value}`;
  }

  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TargetError("Enter a valid web URL or arXiv ID.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetError("Only http and https URLs are supported.");
  }

  url.hash = "";
  return url.toString();
}

export function extractArxivId(targetUrl: string): string | null {
  const url = new URL(targetUrl);
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "arxiv.org" && hostname !== "www.arxiv.org" && hostname !== "ar5iv.labs.arxiv.org") {
    return null;
  }

  const match = url.pathname.match(/^\/(?:abs|pdf|html)\/(.+)$/i);
  if (!match) return null;
  const candidate = match[1].replace(/\.pdf$/i, "");
  return isArxivId(candidate) ? candidate : null;
}

export function routeForTarget(input: string): string {
  return `/${normalizeTarget(input)}`;
}
