import type { BridgeBlobRef } from "@mains/contracts/bridge-blobs";
import type { SQLiteInstance } from "../../db/types";
import { clockOf, compareClock, getClock, type RowClock } from "./bridge.sql";

/** Transfer admission, bounded downloads, coalescing and cache pins share one
 * owner. Stop aborts network I/O and joins every admitted operation before keys
 * are destroyed; queued downloads never acquire a slot after retirement. */
export function createBridgeBlobLifecycle() {
  const abort = new AbortController();
  const operations = new Set<Promise<unknown>>(), jobs = new Map<string, Promise<unknown>>();
  const pins = new Map<string, number>();
  const waiting: Array<{ resolve(): void; reject(error: Error): void }> = [];
  let phase: "active" | "stopping" | "stopped" = "active", slots = 2;
  let stopping: Promise<void> | undefined;
  const stopped = () => new Error("Bridge blob transfer is stopped");
  function assertActive() { if (phase !== "active") throw stopped(); }
  function run<T>(work: () => Promise<T>, key?: string): Promise<T> {
    if (phase !== "active") return Promise.reject(stopped());
    const existing = key ? jobs.get(key) : undefined;
    if (existing) return existing as Promise<T>;
    const job = Promise.resolve().then(() => { assertActive(); return work(); }).finally(() => {
      operations.delete(job); if (key && jobs.get(key) === job) jobs.delete(key);
    });
    operations.add(job); if (key) jobs.set(key, job);
    return job;
  }
  return {
    get active() { return phase === "active"; },
    get signal() { return abort.signal; },
    assertActive, run,
    wait<T>(work: () => T | Promise<T>): Promise<T> {
      if (phase !== "active") return Promise.reject(stopped());
      return new Promise((resolve, reject) => {
        const cancel = () => { abort.signal.removeEventListener("abort", cancel); reject(stopped()); };
        abort.signal.addEventListener("abort", cancel, { once: true });
        Promise.resolve().then(() => { assertActive(); return work(); }).then((value) => {
          abort.signal.removeEventListener("abort", cancel);
          if (phase === "active") resolve(value); else reject(stopped());
        }, (error) => { abort.signal.removeEventListener("abort", cancel); reject(error); });
      });
    },
    pin(path: string) {
      pins.set(path, (pins.get(path) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return; released = true;
        const count = (pins.get(path) ?? 1) - 1;
        if (count) pins.set(path, count); else pins.delete(path);
      };
    },
    pinned: (path: string) => pins.has(path),
    download(key: string, work: () => Promise<string>) {
      return run(async () => {
        if (slots) slots--; else await new Promise<void>((resolve, reject) => { waiting.push({ resolve, reject }); });
        try { assertActive(); return await work(); }
        finally { const next = waiting.shift(); if (next) next.resolve(); else slots++; }
      }, `download:${key}`);
    },
    stop(dispose: () => void) {
      if (stopping) return stopping;
      phase = "stopping"; abort.abort();
      for (const entry of waiting.splice(0)) entry.reject(stopped());
      const result = Promise.allSettled([...operations]).then(() => { dispose(); pins.clear(); phase = "stopped"; });
      stopping = result;
      void result.catch(() => { if (stopping === result) stopping = undefined; });
      return result;
    },
  };
}
/** Upload completion only binds to the generation that supplied those bytes. */
export function bindBridgeBlobManifest(sqlite: SQLiteInstance, clock: RowClock, refs: BridgeBlobRef[]) {
  const current = getClock(sqlite, clock.table_name, clock.pk, clock.register);
  if (current && compareClock(clockOf(clock), clockOf(current)) === 0)
    sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name=? AND pk=? AND register=?")
      .run(JSON.stringify(refs), clock.table_name, clock.pk, clock.register);
}

/** ACK follows exact-generation outbox removal. Unprepared output records also
 * retain their frozen snapshot in metadata, before they have a blob manifest. */
export function releasableBridgeCaptures(sqlite: SQLiteInstance, refs: BridgeBlobRef[]): BridgeBlobRef[] {
  return refs.filter((ref) => ref.kind !== "value" && ref.column === "metadata" &&
    !sqlite.prepare(`SELECT 1 FROM bridge_outbox o JOIN bridge_row_clock c USING(table_name,pk,register)
      WHERE instr(coalesce(c.blob_refs_json,''),?)>0 OR
        (o.table_name='run_artifacts' AND instr(coalesce(json_extract(c.values_json,'$.metadata'),''),?)>0)
      LIMIT 1`).get(ref.blobId, ref.blobId));
}
