type WindowEntry = { count: number; resetsAt: number };

const windows = new Map<string, WindowEntry>();

function lastForwardedAddress(value: string | null): string | null {
  return value
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .at(-1) ?? null;
}

export function clientAddress(request: Request): string {
  if (process.env.VERCEL !== "1") return "non-vercel";
  return (
    lastForwardedAddress(request.headers.get("x-vercel-forwarded-for")) ||
    lastForwardedAddress(request.headers.get("x-forwarded-for")) ||
    request.headers.get("x-real-ip")?.trim() ||
    "vercel-unknown"
  );
}

export function takeRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetsAt <= now) {
    windows.set(key, { count: 1, resetsAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (existing.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((existing.resetsAt - now) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true, retryAfter: 0 };
}
