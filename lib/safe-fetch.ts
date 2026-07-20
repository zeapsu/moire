import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export class SafeFetchError extends Error {}

function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolvePublicUrl(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("Only http and https URLs are supported.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("Credentialed URLs are not supported.");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new SafeFetchError("Private or reserved network addresses are not supported.");
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

export async function assertPublicUrl(url: URL): Promise<void> {
  await resolvePublicUrl(url);
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BYTES) throw new SafeFetchError("The page is too large to read.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      throw new SafeFetchError("The page is too large to read.");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function safeFetchHtml(input: string, timeoutMs = 15_000): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let current = new URL(input);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const pinned = await resolvePublicUrl(current);
      const dispatcher = new Agent({
        connect: {
          lookup(_hostname, options, callback) {
            if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          },
        },
      });
      try {
        const response = await fetch(current, {
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
          dispatcher,
          headers: {
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36 Moire/0.1",
          },
        } as RequestInit & { dispatcher: Agent });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === MAX_REDIRECTS) throw new SafeFetchError("Too many redirects.");
          await response.body?.cancel();
          current = new URL(location, current);
          continue;
        }

        if (!response.ok) throw new SafeFetchError(`The page returned HTTP ${response.status}.`);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
          throw new SafeFetchError("The URL did not return an HTML page.");
        }

        return { html: await readLimitedBody(response), finalUrl: current.toString() };
      } finally {
        await dispatcher.close();
      }
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new SafeFetchError("The page took too long to respond.");
    throw new SafeFetchError("The page could not be reached.");
  } finally {
    clearTimeout(timeout);
  }

  throw new SafeFetchError("Too many redirects.");
}
