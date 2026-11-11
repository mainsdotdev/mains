import { ResourceCleanupError } from "./resource-lifecycle";
import { AsyncLocalStorage } from "node:async_hooks";

type RecordKind = "run" | "workspace" | "collection" | "collection-source" | "project";
export type RecordAction = "archive" | "restore" | "delete" | "delete-worktree" | `source-delete:${string}` | symbol;
interface Owner { action: RecordAction; result: Promise<unknown>; finished: Promise<void>; failed?: boolean; active: boolean }
const owners = new Map<string, Owner>();
const pendingCleanup = new Map<string, { error: ResourceCleanupError; action: RecordAction; committed: boolean }>();
const execution = new AsyncLocalStorage<Owner>();
let admission: "open" | "closing" | "closed" = "open";
let stopping: Promise<void> | undefined;
class DeletedRecordCleanupError extends ResourceCleanupError {
  constructor(readonly key: string, error: unknown, close: () => Promise<void>) {
    super([error], "Record deleted; storage cleanup is pending. Retry deletion.", close);
  }
}

export async function finishRecordDeletion(key: string, cleanup: () => void | Promise<void>): Promise<void> {
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    const pending = Promise.resolve().then(async () => {
      await cleanup();
      if (pendingCleanup.get(key)?.error.close === close) pendingCleanup.delete(key);
    });
    closing = pending;
    void pending.catch(() => { if (closing === pending) closing = undefined; });
    return pending;
  };
  try { await close(); }
  catch (error) { throw new DeletedRecordCleanupError(key, error, close); }
}

export function recordKey(kind: RecordKind, id: string, accountId?: string): string {
  return JSON.stringify([kind, id, accountId]);
}

export function assertRecordAvailable(key: string): void {
  if (owners.has(key) || pendingCleanup.has(key)) throw new Error("This record is being archived, restored or deleted. Wait for that operation to finish.");
}

export function isRecordTransitioning(key: string): boolean { return owners.has(key); }

/** Claim before the first await. Adjacent equal requests share one operation;
 * conflicting requests execute in acceptance order, including after a failure.
 * Persisted archive flags describe visibility, not an operation's ownership. */
export function transitionRecord<T>(key: string, action: RecordAction, work: (scope: { hold(pending: Promise<unknown>): void }) => Promise<T>): Promise<T> {
  if (execution.getStore()?.active === false) return Promise.reject(new Error("Record lifecycle owner has closed"));
  if (admission !== "open" && !execution.getStore()?.active) return Promise.reject(new Error("Record lifecycle is shutting down"));
  const previous = owners.get(key);
  if (previous?.action === action && !previous.failed) return previous.result as Promise<T>;
  let finish!: () => void, resolve!: (value: T | undefined) => void, reject!: (error: unknown) => void;
  const held: Promise<unknown>[] = [];
  const owner: Owner = { action, active: true, result: new Promise<T | undefined>((yes, no) => { resolve = yes; reject = no; }), finished: new Promise<void>((done) => { finish = done; }) };
  owners.set(key, owner);
  void Promise.resolve().then(async () => {
    await previous?.finished;
    try {
      const pending = pendingCleanup.get(key);
      if (pending) {
        await pending.error.close();
        pendingCleanup.delete(key);
        if (pending.action === action && pending.committed) { resolve(undefined); return; }
      }
      resolve(await execution.run(owner, () => work({ hold(pending) { held.push(pending); void pending.catch(() => {}); } })));
    } catch (error) {
      owner.failed = true;
      if (error instanceof ResourceCleanupError) pendingCleanup.set(key, { error, action, committed: error instanceof DeletedRecordCleanupError && error.key === key });
      reject(error);
    }
    finally {
      await Promise.allSettled(held);
      owner.active = false;
      if (owners.get(key) === owner) owners.delete(key);
      finish();
    }
  });
  return owner.result as Promise<T>;
}

export function openRecordLifecycles(): void {
  if (admission === "open") return;
  if (admission !== "closed" || owners.size || pendingCleanup.size) throw new Error("Record lifecycle cleanup is still pending");
  admission = "open"; stopping = undefined;
}

/** Fence new commands, but allow accepted aggregate work to retire its children.
 * SQLite and native adapters stay owned until scripts and cleanup are joined. */
export function shutdownRecordLifecycles(): Promise<void> {
  if (stopping) return stopping;
  admission = "closing";
  const pending = Promise.resolve().then(async () => {
    while (owners.size) await Promise.all([...owners.values()].map((owner) => owner.finished));
    const results = await Promise.allSettled([...pendingCleanup].map(async ([key, value]) => {
      await value.error.close(); if (pendingCleanup.get(key) === value) pendingCleanup.delete(key);
    }));
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new ResourceCleanupError(errors, "Record lifecycle shutdown cleanup failed", shutdownRecordLifecycles);
    admission = "closed";
  });
  stopping = pending;
  void pending.catch(() => { if (stopping === pending) stopping = undefined; });
  return pending;
}
