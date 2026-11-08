/** Full and provider-scoped persistence share one queue. Equal pending requests
 * join through the checkpoint; a rejected request never poisons the next one. */
const reads = new Set<Promise<unknown>>();
const pending = new Map<string, Promise<unknown>>();
let tail: Promise<unknown> = Promise.resolve();
let phase: "open" | "closing" | "closed" = "open";
let stopping: Promise<void> | undefined;
export function runSync<T>(provider: string | undefined, work: () => Promise<T>, scope?: () => string): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("Source sync is shutting down"));
  const key = JSON.stringify([provider ?? "*", scope?.()]);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const result = tail.catch(() => {}).then(work).finally(() => { if (pending.get(key) === result) pending.delete(key); });
  pending.set(key, result); tail = result; return result;
}
export function shutdownSourceSync(): Promise<void> {
  if (stopping) return stopping;
  phase = "closing";
  stopping = Promise.allSettled([tail, ...reads]).then(() => { phase = "closed"; });
  return stopping;
}
export function openSourceSync(): void {
  if (phase === "open") return;
  if (phase !== "closed") throw new Error("Source sync cleanup is still pending");
  phase = "open"; stopping = undefined; tail = Promise.resolve(); pending.clear();
}

export function readSync<T>(work: () => Promise<T>): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("Source sync is shutting down"));
  const result = work().finally(() => reads.delete(result));
  reads.add(result); return result;
}
