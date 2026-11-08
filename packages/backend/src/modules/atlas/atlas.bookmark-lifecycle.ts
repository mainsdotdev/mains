import { randomUUID } from "node:crypto";
import type { AtlasAutoTagging, AtlasBookmarkState } from "@mains/contracts/atlas";

export interface BookmarkJob extends AtlasBookmarkState {
  id: string;
  attempts: number;
  nextAt: number;
  autoTagging: AtlasAutoTagging;
  fingerprint?: string;
  force?: boolean;
}
export function validateBookmarkPolicy(config: AtlasAutoTagging): AtlasAutoTagging {
  if (!config || typeof config.enabled !== "boolean" || typeof config.providerId !== "string" || typeof config.model !== "string"
    || config.providerId.length > 128 || config.model.length > 256 || (config.enabled && (!config.providerId.trim() || !config.model.trim())))
    throw new Error("Choose a provider and model for automatic tagging");
  return { enabled: config.enabled, providerId: config.providerId, model: config.model };
}

export function readBookmarkJob(json: string | null): BookmarkJob | null {
  if (!json) return null;
  try {
    const job = JSON.parse(json) as BookmarkJob;
    return job && typeof job.id === "string" && ["pending", "running", "ready", "failed"].includes(job.status)
      && Number.isInteger(job.attempts) && job.attempts >= 0 && Number.isFinite(job.nextAt)
      && job.autoTagging && typeof job.autoTagging.enabled === "boolean"
      && typeof job.autoTagging.providerId === "string" && typeof job.autoTagging.model === "string" ? job : null;
  } catch { return null; }
}

export function createBookmarkJob(autoTagging: AtlasAutoTagging, previous?: BookmarkJob | null, force = false): BookmarkJob {
  return { id: randomUUID(), status: "pending", attempts: 0, nextAt: 0, autoTagging: { ...autoTagging },
    ...(previous?.fingerprint ? { fingerprint: previous.fingerprint } : {}), ...(force ? { force: true } : {}) };
}

/** All durable job transitions live here. An interrupted attempt is not a failed download/model call. */
export function beginBookmarkJob(job: BookmarkJob, now: number): boolean {
  if (!["pending", "running"].includes(job.status) || job.nextAt > now) return false;
  if (job.status === "pending") job.attempts++;
  else job.attempts = Math.max(1, job.attempts); // Recover a process that died while running.
  job.status = "running"; delete job.error;
  return true;
}
export function finishBookmarkJob(job: BookmarkJob) {
  job.status = "ready"; job.nextAt = 0; delete job.force; delete job.error;
}
export function failBookmarkJob(job: BookmarkJob, error: unknown) {
  job.status = job.attempts < 3 ? "pending" : "failed";
  job.nextAt = Date.now() + 15000 * job.attempts;
  job.error = error instanceof Error ? error.message.slice(0, 500) : "Could not enrich this bookmark";
}
export function interruptBookmarkJob(job: BookmarkJob) {
  job.status = "pending"; job.attempts = Math.max(0, job.attempts - 1); job.nextAt = 0; delete job.error;
}
export function retireBookmarkJob(json: string | null): string | null {
  const job = readBookmarkJob(json);
  if (!job || !["pending", "running"].includes(job.status)) return json;
  if (job.status === "running") interruptBookmarkJob(job);
  job.id = randomUUID();
  return JSON.stringify(job);
}
export function bookmarkJobMatches(row: { kind: string; url: string | null; trashedAt: Date | null; bookmarkJob: string | null } | null,
  jobId: string | undefined, url: string | null): boolean {
  return !!row && row.kind === "bookmark" && !row.trashedAt && row.url === url && readBookmarkJob(row.bookmarkJob)?.id === jobId;
}
export function sameBookmarkPolicy(expected: AtlasAutoTagging, current: AtlasAutoTagging): boolean {
  return expected.enabled && current.enabled && expected.providerId === current.providerId && expected.model === current.model;
}
export function createBookmarkPolicies() {
  const revisions = new Map<string, object>();
  const writes = new Map<string, Promise<unknown>>();
  return {
    revision(accountId: string) {
      if (!revisions.has(accountId)) revisions.set(accountId, {});
      return revisions.get(accountId)!;
    },
    revise(accountId: string) { const revision = {}; revisions.set(accountId, revision); return revision; },
    current(accountId: string, revision: object) { return revisions.get(accountId) === revision; },
    commit<T>(accountId: string, revision: object, write: () => Promise<T>): Promise<T> {
      const pending = Promise.resolve(writes.get(accountId)).catch(() => {}).then(() => {
        if (revisions.get(accountId) !== revision) throw new Error("Automatic tagging settings were superseded");
        return write();
      });
      writes.set(accountId, pending);
      const release = () => { if (writes.get(accountId) === pending) writes.delete(accountId); };
      void pending.then(release, release);
      return pending;
    },
  };
}

/** One worker generation owns its timer, drain and every admitted item operation. */
export function createBookmarkWorker() {
  let phase: "stopped" | "running" | "stopping" = "stopped";
  let controller = new AbortController();
  let preparation = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let draining: Promise<void> | undefined, closing: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>(), claims = new Set<string>();
  const itemRevisions = new Map<string, object>();
  const track = <T>(work: () => Promise<T>): Promise<T> => {
    const task = Promise.resolve().then(work);
    active.add(task);
    void task.then(() => active.delete(task), () => active.delete(task));
    return task;
  };
  return {
    get running() { return phase === "running"; },
    available(key: string) { return !claims.has(key); },
    observeItem(key: string) {
      const revision = itemRevisions.get(key);
      return () => itemRevisions.get(key) === revision;
    },
    retireItem(key: string) { itemRevisions.set(key, {}); },
    prepare<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (phase === "stopping") return Promise.reject(new Error("Bookmark worker is stopping"));
      const signal = preparation.signal;
      return track(() => work(signal));
    },
    start(kick: () => void) {
      if (phase === "stopping") return;
      if (phase === "stopped") {
        controller = new AbortController(); phase = "running";
        timer = setInterval(kick, 15000); timer.unref();
      }
      kick();
    },
    drain(work: () => Promise<void>): Promise<void> {
      if (phase !== "running") return Promise.resolve();
      if (draining) return draining;
      const task = track(work);
      draining = task;
      void task.then(() => { if (draining === task) draining = undefined; }, () => { if (draining === task) draining = undefined; });
      return task;
    },
    run(key: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
      if (phase !== "running" || claims.has(key)) return Promise.resolve();
      const signal = controller.signal;
      claims.add(key);
      return track(async () => { try { await work(signal); } finally { claims.delete(key); } });
    },
    stop(): Promise<void> {
      if (closing) return closing;
      phase = "stopping";
      if (timer) clearInterval(timer); timer = undefined;
      controller.abort();
      preparation.abort(new Error("Bookmark worker is stopping"));
      closing = Promise.allSettled([...active]).then(() => {
        phase = "stopped"; closing = undefined; preparation = new AbortController(); itemRevisions.clear();
      });
      return closing;
    },
  };
}
