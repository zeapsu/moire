const ARXIV_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;

export class TargetError extends Error {}

export function normalizeTarget(rawTarget: string): string {
  let value = rawTarget.trim();
  if (!value) throw new TargetError("Enter a URL or arXiv ID.");

  try {
    value = decodeURIComponent(value);
  } catch {
    // The route can already be decoded by Next.js.
  }

  value = value.replace(/^(https?):\/(?!\/)/i, "$1://");

  if (ARXIV_ID.test(value)) {
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

  const match = url.pathname.match(/\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/i);
  return match?.[1] ?? null;
}

export function routeForTarget(input: string): string {
  return `/${normalizeTarget(input)}`;
}
