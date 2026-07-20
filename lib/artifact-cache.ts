import {
  ArtifactQueueFullError,
  generateArtifact,
  promoteArtifactTask,
  repairRuntimeFailure,
  type ArtifactPriority,
} from "@/lib/artifact";
import { normalizeTarget } from "@/lib/target";
import {
  emptyRepairState,
  type ArtifactDescriptor,
  type ArtifactResult,
  type ArtifactStatus,
  type CachedArtifactResult,
  type RepairState,
  type VisualizationBrief,
} from "@/lib/types";

const CACHE_TTL_MS = 60 * 60_000;
const MAX_CACHE_ENTRIES = 120;

type ArtifactRecord = {
  artifactId: string;
  cacheKey: string;
  targetUrl: string;
  brief: VisualizationBrief;
  status: ArtifactStatus;
  repairState: RepairState;
  result?: ArtifactResult;
  generationPromise?: Promise<ArtifactResult>;
  repairPromise?: Promise<ArtifactResult>;
  lastAccessedAt: number;
};

type ArtifactStore = {
  byId: Map<string, ArtifactRecord>;
  idByKey: Map<string, string>;
};

type CacheGlobal = typeof globalThis & {
  __moireArtifactStore?: ArtifactStore;
};

const cacheGlobal = globalThis as CacheGlobal;
const store =
  cacheGlobal.__moireArtifactStore ??
  (cacheGlobal.__moireArtifactStore = {
    byId: new Map<string, ArtifactRecord>(),
    idByKey: new Map<string, string>(),
  });

export class ArtifactNotFoundError extends Error {}
export class ArtifactNotReadyError extends Error {}
export class ArtifactCacheFullError extends Error {}

function cacheKey(targetUrl: string, brief: VisualizationBrief, variantKey?: string): string {
  return `${targetUrl}\u0000${brief.anchor.dom_selector}\u0000${variantKey ?? "page"}`;
}

function dropRecord(record: ArtifactRecord): void {
  store.byId.delete(record.artifactId);
  if (store.idByKey.get(record.cacheKey) === record.artifactId) store.idByKey.delete(record.cacheKey);
}

function evictableRecords(): ArtifactRecord[] {
  return [...store.byId.values()]
    .filter((record) => record.status !== "generating" && record.status !== "repairing")
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
}

function sweepCache(now = Date.now(), reserve = 0): void {
  for (const record of evictableRecords()) {
    if (now - record.lastAccessedAt > CACHE_TTL_MS) dropRecord(record);
  }

  const overflow = store.byId.size + reserve - MAX_CACHE_ENTRIES;
  if (overflow <= 0) return;
  for (const record of evictableRecords().slice(0, overflow)) dropRecord(record);
}

function descriptor(record: ArtifactRecord): ArtifactDescriptor {
  return { artifactId: record.artifactId, status: record.status, brief: record.brief };
}

function requireRecord(artifactId: string): ArtifactRecord {
  const record = store.byId.get(artifactId);
  if (!record) throw new ArtifactNotFoundError("The visualization is no longer in this server's cache.");
  const now = Date.now();
  if (
    record.status !== "generating" &&
    record.status !== "repairing" &&
    now - record.lastAccessedAt > CACHE_TTL_MS
  ) {
    dropRecord(record);
    throw new ArtifactNotFoundError("The visualization is no longer in this server's cache.");
  }
  record.lastAccessedAt = now;
  return record;
}

function withServerRepairState(result: ArtifactResult, repairState: RepairState): ArtifactResult {
  return result.ok
    ? { ok: true, html: result.html, repairState }
    : { ok: false, error: result.error, repairState };
}

function envelope(record: ArtifactRecord, result: ArtifactResult, cached: boolean): CachedArtifactResult {
  return { ...result, artifactId: record.artifactId, cached };
}

export function registerArtifactBriefs(
  targetUrl: string,
  briefs: VisualizationBrief[],
  options: { variantKey?: string } = {},
): ArtifactDescriptor[] {
  sweepCache();
  const normalizedTarget = normalizeTarget(targetUrl);

  return briefs.map((brief) => {
    const key = cacheKey(normalizedTarget, brief, options.variantKey);
    const existingId = store.idByKey.get(key);
    const existing = existingId ? store.byId.get(existingId) : undefined;
    if (existing) {
      existing.lastAccessedAt = Date.now();
      if (existing.status === "idle") existing.brief = brief;
      return descriptor(existing);
    }

    sweepCache(Date.now(), 1);
    if (store.byId.size >= MAX_CACHE_ENTRIES) {
      throw new ArtifactCacheFullError("The visualization cache is busy. Try again shortly.");
    }

    const record: ArtifactRecord = {
      artifactId: crypto.randomUUID(),
      cacheKey: key,
      targetUrl: normalizedTarget,
      brief,
      status: "idle",
      repairState: emptyRepairState(),
      lastAccessedAt: Date.now(),
    };
    store.byId.set(record.artifactId, record);
    store.idByKey.set(key, record.artifactId);
    return descriptor(record);
  });
}

export async function generateCachedArtifact(
  artifactId: string,
  priority: ArtifactPriority = "interactive",
): Promise<CachedArtifactResult> {
  const record = requireRecord(artifactId);
  if (record.result && (record.status === "ready" || record.status === "error")) {
    return envelope(record, withServerRepairState(record.result, record.repairState), true);
  }
  if (record.generationPromise) {
    if (priority === "interactive") promoteArtifactTask(record.artifactId);
    return envelope(record, await record.generationPromise, true);
  }
  if (record.status === "repairing") {
    throw new ArtifactNotReadyError("The visualization is already being repaired.");
  }

  record.status = "generating";
  const work = generateArtifact(record.brief, priority, record.artifactId)
    .then((result) => {
      record.repairState = result.repairState;
      record.result = result;
      record.status = result.ok ? "ready" : "error";
      record.lastAccessedAt = Date.now();
      return result;
    })
    .catch((error) => {
      if (error instanceof ArtifactQueueFullError || (error instanceof Error && error.message.includes("OPENAI_API_KEY"))) {
        record.status = "idle";
        throw error;
      }
      console.error("Artifact generation pipeline failed", { artifactId: record.artifactId, error });
      const terminalResult: ArtifactResult = {
        ok: false,
        error: "The visualization generation failed before it produced an artifact.",
        repairState: record.repairState,
      };
      record.result = terminalResult;
      record.status = "error";
      record.lastAccessedAt = Date.now();
      return terminalResult;
    })
    .finally(() => {
      record.generationPromise = undefined;
    });
  record.generationPromise = work;
  return envelope(record, await work, false);
}

export async function repairCachedArtifact(artifactId: string, runtimeError: string): Promise<CachedArtifactResult> {
  const record = requireRecord(artifactId);
  const current = record.result;
  if (!current?.ok) throw new ArtifactNotReadyError("The visualization is not ready for runtime repair.");

  const diagnostic = runtimeError.slice(0, 2000);
  if (record.repairPromise) {
    record.repairState = { ...record.repairState, lastFailure: { stage: "runtime", message: diagnostic } };
    record.result = withServerRepairState(current, record.repairState);
    return envelope(
      record,
      {
        ok: false,
        error: "The visualization could not start after its runtime repair.",
        repairState: record.repairState,
      },
      true,
    );
  }
  if (record.repairState.attempts.runtime === 1) {
    record.repairState = { ...record.repairState, lastFailure: { stage: "runtime", message: diagnostic } };
    const terminalResult: ArtifactResult = {
      ok: false,
      error: "The visualization could not start after its runtime repair.",
      repairState: record.repairState,
    };
    record.result = terminalResult;
    record.status = "error";
    return envelope(record, terminalResult, true);
  }

  const priorState = record.repairState;
  record.repairState = {
    attempts: { validation: priorState.attempts.validation, runtime: 1 },
    lastFailure: { stage: "runtime", message: diagnostic },
  };
  record.result = withServerRepairState(current, record.repairState);
  record.status = "repairing";

  const work = repairRuntimeFailure(record.brief, current.html, diagnostic, priorState)
    .then((result) => {
      const authoritativeState: RepairState = {
        attempts: { validation: result.repairState.attempts.validation, runtime: 1 },
        lastFailure: result.repairState.lastFailure,
      };
      const authoritativeResult = withServerRepairState(result, authoritativeState);
      record.repairState = authoritativeState;
      record.result = authoritativeResult;
      record.status = authoritativeResult.ok ? "ready" : "error";
      record.lastAccessedAt = Date.now();
      return authoritativeResult;
    })
    .catch((error) => {
      console.error("Artifact runtime repair failed", { artifactId: record.artifactId, error });
      const terminalResult: ArtifactResult = {
        ok: false,
        error: "The visualization runtime repair could not be completed.",
        repairState: record.repairState,
      };
      record.result = terminalResult;
      record.status = "error";
      record.lastAccessedAt = Date.now();
      return terminalResult;
    })
    .finally(() => {
      record.repairPromise = undefined;
    });
  record.repairPromise = work;
  return envelope(record, await work, false);
}

export function resetArtifactCacheForTests(): void {
  store.byId.clear();
  store.idByKey.clear();
}
