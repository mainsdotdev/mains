import { createHash, randomUUID } from "node:crypto";

interface State {
  revision: string;
  pending?: { signature: string; result: Promise<unknown> };
  failed?: { signature: string; revision: string };
}
export interface ConnectionLease {
  revision: string;
  current(): boolean;
  assertCurrent(): void;
}
const states = new Map<string, State>();
const reads = new Set<Promise<unknown>>();
let phase: "open" | "closing" | "closed" = "open";
let stopping: Promise<void> | undefined;

function stateFor(provider: string): State {
  let state = states.get(provider);
  if (!state) {
    state = { revision: randomUUID() };
    states.set(provider, state);
  }
  return state;
}
export function connectionsAccepting(): boolean { return phase === "open"; }
export function captureConnectionLease(provider: string): ConnectionLease {
  const state = stateFor(provider), revision = state.revision;
  const current = () => phase === "open" && states.get(provider) === state && state.revision === revision && !state.pending;
  return {
    revision, current,
    assertCurrent() {
      if (!current()) throw new Error("This connection changed. Refresh it and try again.");
    },
  };
}

/** Latest admitted intent owns activation/retirement. Equal in-flight requests
 * join; a revoke retires old reads before reaching SQLite. Signatures retain
 * hashes only, never the credentials. A failed intent can retry itself while
 * it remains the latest intent; it cannot revive earlier leases or selections. */
export function mutateConnection<T, P extends { provider: string; expectedRevision?: string }>(
  input: P,
  action: string,
  work: (lease: ConnectionLease) => Promise<T>,
): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("Connections are shutting down"));
  const state = stateFor(input.provider);
  const signature = createHash("sha256").update(JSON.stringify([action, input], (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  )).digest("hex");
  if (state.pending?.signature === signature) return state.pending.result as Promise<T>;
  const retrying = state.failed?.signature === signature && state.failed.revision === state.revision;
  if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision && !retrying) {
    return Promise.reject(new Error("This connection changed. Reopen its settings and try again."));
  }
  const previous = state.pending?.result, revision = randomUUID();
  state.revision = revision;
  state.failed = undefined;
  const current = () => phase !== "closed" && states.get(input.provider) === state && state.revision === revision;
  const lease: ConnectionLease = {
    revision, current,
    assertCurrent() {
      if (!current()) throw new Error("This connection action was superseded by a newer request.");
    },
  };
  const result = Promise.resolve(previous).catch(() => {}).then(async () => {
    lease.assertCurrent();
    return work(lease);
  }).catch((error) => {
    if (current()) state.failed = { signature, revision };
    throw error;
  }).finally(() => {
    if (state.pending?.result === result) state.pending = undefined;
  });
  state.pending = { signature, result };
  return result;
}
export function readConnection<T>(work: () => Promise<T>): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("Connections are shutting down"));
  const result = work().finally(() => reads.delete(result));
  reads.add(result);
  return result;
}
export function openConnectionLifecycle(): void {
  if (phase === "open") return;
  if (phase !== "closed") throw new Error("Connection cleanup is still pending");
  states.clear();
  phase = "open";
  stopping = undefined;
}
export function shutdownConnectionLifecycle(): Promise<void> {
  if (stopping) return stopping;
  phase = "closing";
  stopping = Promise.allSettled([
    ...reads,
    ...[...states.values()].flatMap((state) => state.pending ? [state.pending.result] : []),
  ]).then(() => { phase = "closed"; });
  return stopping;
}
