let phase: "open" | "closing" | "closed" = "open";
let stopping: Promise<void> | undefined;
const admitted = new Set<Promise<unknown>>();
export function openFileWrites(): void {
  if (phase === "open") return;
  if (phase !== "closed") throw new Error("Editor writes are still shutting down");
  phase = "open"; stopping = undefined;
}
export function acceptFileWrite<T>(work: () => Promise<T>): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("Editor writes are shutting down"));
  let workResult: Promise<T>;
  try { workResult = work(); } catch (error) { return Promise.reject(error); }
  const pending = workResult.finally(() => admitted.delete(pending));
  admitted.add(pending); return pending;
}
export function shutdownFileWrites(): Promise<void> {
  if (stopping) return stopping;
  phase = "closing";
  stopping = Promise.allSettled([...admitted]).then(() => { phase = "closed"; });
  return stopping;
}

const tails = new Map<string, Promise<unknown>>();

/** Canonical file identity serializes both the baseline check and the write.
 * A failed writer does not poison the queue or grant another stale baseline. */
export function runFileWrite<T>(filePath: string, write: () => Promise<T>): Promise<T> {
  const previous = tails.get(filePath);
  const result = Promise.resolve(previous).catch(() => {}).then(write).finally(() => {
    if (tails.get(filePath) === result) tails.delete(filePath);
  });
  tails.set(filePath, result);
  return result;
}
