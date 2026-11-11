import type { ConversationSettings } from "@mains/contracts/run-settings";
import { getTransport, onTransportChange } from "./transport/registry";
import type { Transport } from "./transport/types";

let transportEpoch = 0;
onTransportChange(() => { transportEpoch++; });
export const getConversationTransportEpoch = () => transportEpoch;

/** Any observed disconnect/swap retires the receipt permanently, including an
 * away-and-back transition to the same transport object. */
export function captureConversationOwner(
  transport: Transport,
  valid: () => boolean = () => true,
  signal?: AbortSignal,
) {
  let active = true;
  const cleanups: Array<() => void> = [];
  function release() {
    active = false;
    for (const off of cleanups.splice(0)) off();
  }
  function current() {
    if (active && (signal?.aborted || getTransport() !== transport || transport.status() !== "connected" || !valid())) {
      release();
    }
    return active;
  }
  function watch(subscribe: () => () => void) {
    const off = subscribe();
    if (active) cleanups.push(off);
    else off();
  }
  try {
    if (current()) {
      watch(() => onTransportChange(release));
      watch(() => transport.onStatusChange((status) => { if (status !== "connected") release(); }));
      if (signal) {
        signal.addEventListener("abort", release, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", release));
      }
    }
  } catch (error) {
    release();
    throw error;
  }
  return { transport, current, release };
}

/** New reads supersede old receipts for the same logical key. Polls may skip an
 * outstanding read; releasing an old request never releases its successor. */
export function createConversationReadLifecycle() {
  type Read = { transport: Transport; current(): boolean; release(): void };
  const reads = new Map<string, Read>();
  let active = true;
  let scope: unknown;
  function release() {
    active = false;
    for (const read of [...reads.values()]) read.release();
  }
  return {
    bound: (key: unknown) => active && scope === key,
    bind(next: unknown) {
      if (!active || next !== scope) {
        release();
        scope = next;
        active = true;
      }
    },
    release,
    begin(key: string, transport: Transport, options: { valid?: () => boolean; signal?: AbortSignal; skipPending?: boolean } = {}): Read | null {
      if (!active) return null;
      const owner = captureConversationOwner(transport, options.valid, options.signal);
      if (!owner.current()) { owner.release(); return null; }
      const previous = reads.get(key);
      if (options.skipPending && previous?.current()) { owner.release(); return null; }
      previous?.release();
      const read: Read = {
        transport,
        current: () => active && reads.get(key) === read && owner.current(),
        release() {
          owner.release();
          if (reads.get(key) === read) reads.delete(key);
        },
      };
      reads.set(key, read);
      if (!read.current()) { read.release(); return null; }
      return read;
    },
  };
}

/** A terminal effect belongs to one execution, not just a terminal run id.
 * Continue and cache reset retire even an already-running diagnostic lookup. */
export function createConversationFinalizationLifecycle() {
  const claims = new Map<string, object>();
  return {
    claim(id: string): { current(): boolean } | null {
      if (claims.has(id)) return null;
      const claim = {};
      claims.set(id, claim);
      return { current: () => claims.get(id) === claim };
    },
    has: (id: string) => claims.has(id),
    running(id: string) { claims.delete(id); },
    clear() { claims.clear(); },
  };
}

/** Accepted writes stay with their original transport and run. A send barrier
 * drains successors too; an edit admitted during its wait cannot be overtaken. */
export function createConversationSettingsLifecycle<Owner extends object>() {
  const owners = new WeakMap<Owner, Map<string, Promise<void>>>();
  return {
    write(
      owner: Owner,
      id: string,
      settings: ConversationSettings,
      save: (snapshot: ConversationSettings) => Promise<void>,
    ) {
      const snapshot = { model: settings.model, config: { ...settings.config } };
      let writes = owners.get(owner);
      if (!writes) {
        writes = new Map();
        owners.set(owner, writes);
      }
      const job = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(() => save(snapshot));
      writes.set(id, job);
      void job.finally(() => { if (writes.get(id) === job) writes.delete(id); }).catch(() => {});
      return job;
    },
    async wait(owner: Owner, id: string): Promise<void> {
      for (;;) {
        const job = owners.get(owner)?.get(id);
        if (!job) return;
        try { await job; }
        catch (error) {
          const successor = owners.get(owner)?.get(id);
          if (!successor || successor === job) throw error;
        }
      }
    },
    pending: (owner: Owner, id: string) => owners.get(owner)?.has(id) ?? false,
  };
}
