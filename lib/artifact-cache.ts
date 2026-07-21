import { createHash } from "node:crypto";
import { getCache } from "@vercel/functions";
import { unstable_cache } from "next/cache";
import {
  ArtifactQueueFullError,
  ARTIFACT_RUNTIME_BRIDGE_VERSION,
  generateArtifact,
  promoteArtifactTask,
  repairRuntimeFailure,
  validateArtifact,
  withArtifactCsp,
  type ArtifactPriority,
} from "@/lib/artifact";
import { normalizeTarget } from "@/lib/target";
import { OpenAIConfigurationError } from "@/lib/openai";
import {
  briefSchema,
  emptyRepairState,
  repairStateSchema,
  type ArtifactDescriptor,
  type ArtifactKind,
  type ArtifactResult,
  type ArtifactStatus,
  type CachedArtifactResult,
  type RepairState,
  type VisualizationBrief,
} from "@/lib/types";

const CACHE_TTL_MS = 60 * 60_000;
const CACHE_TTL_SECONDS = CACHE_TTL_MS / 1000;
const MAX_CACHE_ENTRIES = 120;
const runtimeStore = getCache({ namespace: "moire-artifacts-v1" });

type ArtifactRecord = {
  artifactId: string;
  cacheKey: string;
  targetUrl: string;
  brief: VisualizationBrief;
  kind: ArtifactKind;
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

type PersistedArtifactRecord = Omit<ArtifactRecord, "generationPromise" | "repairPromise">;

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

function artifactIdForKey(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function persistedRecord(value: unknown): PersistedArtifactRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedArtifactRecord>;
  const parsedBrief = briefSchema.safeParse(candidate.brief);
  if (
    typeof candidate.artifactId !== "string" ||
    typeof candidate.cacheKey !== "string" ||
    typeof candidate.targetUrl !== "string" ||
    (candidate.kind !== "page" && candidate.kind !== "selection") ||
    !["idle", "generating", "ready", "repairing", "error"].includes(candidate.status ?? "") ||
    typeof candidate.lastAccessedAt !== "number" ||
    !parsedBrief.success ||
    !repairStateSchema.safeParse(candidate.repairState).success
  ) {
    return null;
  }
  if (candidate.result) {
    if (candidate.result.ok) {
      if (typeof candidate.result.html !== "string" || !repairStateSchema.safeParse(candidate.result.repairState).success) {
        return null;
      }
    } else if (
      typeof candidate.result.error !== "string" ||
      !repairStateSchema.safeParse(candidate.result.repairState).success
    ) {
      return null;
    }
  }
  return { ...(candidate as PersistedArtifactRecord), brief: parsedBrief.data };
}

async function persistRecord(record: ArtifactRecord): Promise<void> {
  const { generationPromise: _generationPromise, repairPromise: _repairPromise, ...persisted } = record;
  await runtimeStore.set(record.artifactId, persisted, {
    ttl: CACHE_TTL_SECONDS,
    tags: ["moire-artifacts"],
    name: `Moiré artifact ${record.artifactId}`,
  });
}

function installRecord(record: ArtifactRecord): ArtifactRecord {
  store.byId.set(record.artifactId, record);
  store.idByKey.set(record.cacheKey, record.artifactId);
  return record;
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
  return { artifactId: record.artifactId, status: record.status, kind: record.kind, brief: record.brief };
}

function touchRecord(record: ArtifactRecord | undefined): ArtifactRecord {
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

function requireLocalRecord(artifactId: string): ArtifactRecord {
  return touchRecord(store.byId.get(artifactId));
}

async function requirePersistentRecord(artifactId: string): Promise<ArtifactRecord> {
  let record = store.byId.get(artifactId);
  if (!record) {
    const restored = persistedRecord(await runtimeStore.get(artifactId));
    if (restored) record = installRecord(restored);
  }
  return touchRecord(record);
}

const generateDurableArtifact = unstable_cache(
  async (artifactId: string, brief: VisualizationBrief): Promise<ArtifactResult> =>
    generateArtifact(brief, "interactive", artifactId),
  ["moire-artifact-generation-v1"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["moire-artifacts"] },
);

const repairDurableArtifact = unstable_cache(
  async (
    artifactId: string,
    brief: VisualizationBrief,
    invalidHtml: string,
    validationAttempts: 0 | 1,
  ): Promise<ArtifactResult> =>
    repairRuntimeFailure(brief, invalidHtml, "The artifact did not complete browser startup.", {
      attempts: { validation: validationAttempts, runtime: 0 },
      lastFailure: null,
    }),
  ["moire-artifact-runtime-repair-v1"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["moire-artifacts"] },
);

function withServerRepairState(result: ArtifactResult, repairState: RepairState): ArtifactResult {
  return result.ok
    ? { ok: true, html: result.html, repairState }
    : { ok: false, error: result.error, repairState };
}

function envelope(record: ArtifactRecord, result: ArtifactResult, cached: boolean): CachedArtifactResult {
  if (result.ok && !result.html.includes(`data-moire-runtime-bridge="${ARTIFACT_RUNTIME_BRIDGE_VERSION}"`)) {
    const html = withArtifactCsp(result.html, record.brief.render);
    if (record.result?.ok && record.result.html === result.html) record.result = { ...record.result, html };
    return { ...result, html, artifactId: record.artifactId, cached };
  }
  return { ...result, artifactId: record.artifactId, cached };
}

export function registerArtifactBriefs(
  targetUrl: string,
  briefs: VisualizationBrief[],
  options: { variantKey?: string; kind?: ArtifactKind } = {},
): ArtifactDescriptor[] {
  const normalizedTarget = normalizeTarget(targetUrl);
  const keys = briefs.map((brief) => cacheKey(normalizedTarget, brief, options.variantKey));
  const now = Date.now();
  const missingKeys = new Set(
    keys.filter((key) => {
      const existingId = store.idByKey.get(key);
      const existing = existingId ? store.byId.get(existingId) : undefined;
      return (
        !existing ||
        (existing.status !== "generating" &&
          existing.status !== "repairing" &&
          now - existing.lastAccessedAt > CACHE_TTL_MS)
      );
    }),
  );
  sweepCache(now, missingKeys.size);
  if (store.byId.size + missingKeys.size > MAX_CACHE_ENTRIES) {
    throw new ArtifactCacheFullError("The visualization cache is busy. Try again shortly.");
  }

  return briefs.map((brief, index) => {
    const key = keys[index];
    const existingId = store.idByKey.get(key);
    const existing = existingId ? store.byId.get(existingId) : undefined;
    if (existing) {
      existing.lastAccessedAt = now;
      if (existing.status === "idle") existing.brief = brief;
      return descriptor(existing);
    }

    const record: ArtifactRecord = {
      artifactId: artifactIdForKey(key),
      cacheKey: key,
      targetUrl: normalizedTarget,
      brief,
      kind: options.kind ?? "page",
      status: "idle",
      repairState: emptyRepairState(),
      lastAccessedAt: now,
    };
    store.byId.set(record.artifactId, record);
    store.idByKey.set(key, record.artifactId);
    return descriptor(record);
  });
}

export async function synchronizeArtifactBriefs(descriptors: ArtifactDescriptor[]): Promise<ArtifactDescriptor[]> {
  if (process.env.VERCEL !== "1") return descriptors;
  return Promise.all(
    descriptors.map(async (candidate) => {
      const local = store.byId.get(candidate.artifactId);
      if (!local) return candidate;
      const restored = persistedRecord(await runtimeStore.get(candidate.artifactId));
      if (restored && Date.now() - restored.lastAccessedAt <= CACHE_TTL_MS) {
        const record = installRecord({ ...restored, lastAccessedAt: Date.now() });
        await persistRecord(record);
        return descriptor(record);
      }
      await persistRecord(local);
      return descriptor(local);
    }),
  );
}

export async function primeCachedArtifacts(
  descriptors: ArtifactDescriptor[],
  htmlByArtifact: Map<string, string>,
): Promise<ArtifactDescriptor[]> {
  return Promise.all(
    descriptors.map(async (candidate) => {
      const record = store.byId.get(candidate.artifactId);
      const html = htmlByArtifact.get(candidate.artifactId);
      if (!record || !html) return candidate;
      record.brief = candidate.brief;
      const validation = validateArtifact(html, record.brief.render, record.brief.parameters.length);
      if (!validation.ok) {
        throw new Error(`Curated artifact ${record.artifactId} is invalid: ${validation.errors.join(" ")}`);
      }
      const secured = withArtifactCsp(html, record.brief.render);
      if (Buffer.byteLength(secured, "utf8") > 200 * 1024) {
        throw new Error(`Curated artifact ${record.artifactId} exceeds the artifact size limit.`);
      }
      record.repairState = emptyRepairState();
      record.result = { ok: true, html: secured, repairState: record.repairState };
      record.status = "ready";
      record.lastAccessedAt = Date.now();
      await persistRecord(record);
      return descriptor(record);
    }),
  );
}

export function readyCachedArtifacts(descriptors: ArtifactDescriptor[]): CachedArtifactResult[] {
  return descriptors.flatMap((candidate) => {
    const record = store.byId.get(candidate.artifactId);
    if (!record?.result?.ok || record.status !== "ready") return [];
    return [envelope(record, withServerRepairState(record.result, record.repairState), true)];
  });
}

export async function generateCachedArtifact(
  artifactId: string,
  priority: ArtifactPriority = "interactive",
): Promise<CachedArtifactResult> {
  const record =
    process.env.VERCEL === "1" ? await requirePersistentRecord(artifactId) : requireLocalRecord(artifactId);
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
  if (process.env.VERCEL === "1") await persistRecord(record);
  const generation =
    process.env.VERCEL === "1"
      ? generateDurableArtifact(record.artifactId, record.brief)
      : generateArtifact(record.brief, priority, record.artifactId);
  const work = generation
    .then(async (result) => {
      record.repairState = result.repairState;
      record.result = result;
      record.status = result.ok ? "ready" : "error";
      record.lastAccessedAt = Date.now();
      await persistRecord(record);
      return result;
    })
    .catch(async (error) => {
      if (error instanceof ArtifactQueueFullError || error instanceof OpenAIConfigurationError) {
        record.status = "idle";
        await persistRecord(record);
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
      await persistRecord(record);
      return terminalResult;
    })
    .finally(() => {
      record.generationPromise = undefined;
    });
  record.generationPromise = work;
  return envelope(record, await work, false);
}

export async function repairCachedArtifact(artifactId: string, runtimeError: string): Promise<CachedArtifactResult> {
  const record =
    process.env.VERCEL === "1" ? await requirePersistentRecord(artifactId) : requireLocalRecord(artifactId);
  const current = record.result;
  if (!current?.ok) throw new ArtifactNotReadyError("The visualization is not ready for runtime repair.");

  const diagnostic = runtimeError.slice(0, 2000);
  if (record.repairPromise) {
    record.repairState = { ...record.repairState, lastFailure: { stage: "runtime", message: diagnostic } };
    record.result = withServerRepairState(current, record.repairState);
    return envelope(record, await record.repairPromise, true);
  }
  if (record.repairState.attempts.runtime === 1) {
    record.repairState = { ...record.repairState, lastFailure: { stage: "runtime", message: diagnostic } };
    record.result = withServerRepairState(current, record.repairState);
    record.status = "ready";
    record.lastAccessedAt = Date.now();
    await persistRecord(record);
    const terminalResult: ArtifactResult = {
      ok: false,
      error: "The visualization could not start after its runtime repair.",
      repairState: record.repairState,
    };
    return envelope(record, terminalResult, true);
  }

  const priorState = record.repairState;
  record.repairState = {
    attempts: { validation: priorState.attempts.validation, runtime: 1 },
    lastFailure: { stage: "runtime", message: diagnostic },
  };
  record.result = withServerRepairState(current, record.repairState);
  record.status = "repairing";
  if (process.env.VERCEL === "1") await persistRecord(record);

  const repair =
    process.env.VERCEL === "1"
      ? repairDurableArtifact(record.artifactId, record.brief, current.html, priorState.attempts.validation)
      : repairRuntimeFailure(record.brief, current.html, diagnostic, priorState);
  const work = repair
    .then(async (result) => {
      const authoritativeState: RepairState = {
        attempts: { validation: result.repairState.attempts.validation, runtime: 1 },
        lastFailure: result.ok ? record.repairState.lastFailure : result.repairState.lastFailure,
      };
      const authoritativeResult = withServerRepairState(result, authoritativeState);
      record.repairState = authoritativeState;
      record.result = authoritativeResult;
      record.status = authoritativeResult.ok ? "ready" : "error";
      record.lastAccessedAt = Date.now();
      await persistRecord(record);
      return authoritativeResult;
    })
    .catch(async (error) => {
      if (error instanceof ArtifactQueueFullError || error instanceof OpenAIConfigurationError) {
        const retryableState: RepairState = {
          attempts: priorState.attempts,
          lastFailure: record.repairState.lastFailure,
        };
        record.repairState = retryableState;
        record.result = withServerRepairState(current, retryableState);
        record.status = "ready";
        record.lastAccessedAt = Date.now();
        await persistRecord(record);
        throw error;
      }
      console.error("Artifact runtime repair failed", { artifactId: record.artifactId, error });
      const terminalResult: ArtifactResult = {
        ok: false,
        error: "The visualization runtime repair could not be completed.",
        repairState: record.repairState,
      };
      record.result = terminalResult;
      record.status = "error";
      record.lastAccessedAt = Date.now();
      await persistRecord(record);
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
