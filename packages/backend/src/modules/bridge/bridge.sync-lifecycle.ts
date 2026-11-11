import type { BridgePushResult } from "@mains/contracts/bridge-protocol";
import type { BridgeStore, OutboxEntry, PreparedRecord } from "./bridge.store";
import { getClock } from "./bridge.sql";

/** Validate the whole reply before any accepted generation is committed. */
export function validateAcknowledgements(prepared: PreparedRecord[], results: BridgePushResult[]) {
  if (results.length !== prepared.length) throw new Error("Bridge ACK count does not match the push");
  for (const [index, result] of results.entries()) {
    if ("error" in result) continue;
    if (result.publicationId !== (prepared[index].envelope.auth?.publicationId ?? "")) throw new Error("Bridge ACK identifies a different publication");
    if ("seq" in result && (!Number.isSafeInteger(result.seq) || result.seq < 1)) throw new Error("Invalid Bridge ACK sequence");
  }
}

/** An ACK can release only the exact captured generation it sent. */
export function clearAcknowledgedGeneration(store: BridgeStore, entry: OutboxEntry) {
  store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=? AND generation=?")
    .run(entry.table_name, entry.pk, entry.register, entry.generation);
}

export function acknowledgePublication(store: BridgeStore, sent: PreparedRecord, seq: number, synthetic = false) {
  const { entry } = sent;
  store.sqlite.transaction(() => {
    // A replacement's journaled ciphertext must survive an older receipt.
    store.sqlite.prepare("DELETE FROM bridge_publications WHERE table_name=? AND pk=? AND register=? AND stream=? AND envelope=?")
      .run(entry.table_name, entry.pk, entry.register, entry.stream, JSON.stringify(sent.envelope));
    // File metadata copied into another run stream has no outbox row of its own.
    if (synthetic) return;
    const clock = getClock(store.sqlite, entry.table_name, entry.pk, entry.register);
    if (clock && clock.physical_ms === sent.clock.physical_ms && clock.counter === sent.clock.counter && clock.origin === sent.clock.origin)
      store.sqlite.prepare("UPDATE bridge_row_clock SET synced_seq=max(coalesce(synced_seq,0),?),dirty=0,last_ack_ms=? WHERE table_name=? AND pk=? AND register=?")
        .run(seq, Date.now(), entry.table_name, entry.pk, entry.register);
    clearAcknowledgedGeneration(store, entry);
  })();
}

/** Scheduling and ownership of one Bridge replication loop. */
export function createBridgeSyncLifecycle(options: { autoStart?: boolean; activeIntervalMs?: number }) {
  let phase: "active" | "paused" | "stopped" = "active", generation = 0;
  let inFlight: Promise<void> | undefined, stopping: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requested = false, failures = 0, failureRetryAt = 0, writeRetryAt = 0;
  let stalls = 0, stalledOutbox = "";
  const activeInterval = options.activeIntervalMs ?? 1000;
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
  const current = (revision: number) => phase === "active" && generation === revision;
  return {
    get stopped() { return phase === "stopped"; },
    get paused() { return phase === "paused"; },
    get inFlight() { return inFlight; },
    get requested() { return requested; },
    get failures() { return failures; },
    get writeRetryAt() { return writeRetryAt; },
    stalled(signature: string) { return stalls > 0 && signature === stalledOutbox; },
    request() { if (phase !== "stopped") requested = true; },
    beginCycle() { requested = false; },
    succeeded() { failures = 0; failureRetryAt = 0; },
    failed() { failures++; failureRetryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)); },
    rateLimited() { writeRetryAt = Date.now() + 60_000; },
    progress(sent: number, pending: number, signature: string) {
      if (sent || !pending) { stalls = 0; stalledOutbox = ""; }
      else { stalls++; stalledOutbox = signature; }
    },
    delay(input: { active: boolean; safety: number; readOnly: boolean; pending: number; quotaAt: number }) {
      const now = Date.now();
      const retry = now < writeRetryAt ? writeRetryAt - now : stalls ? Math.min(60_000, activeInterval * 2 ** Math.min(stalls, 6)) : activeInterval;
      const interval = input.active ? Math.min(retry, input.safety) :
        input.readOnly && input.pending > 0 ? Math.min(input.safety, Math.max(0, input.quotaAt - now)) : input.safety;
      return failures ? Math.max(0, failureRetryAt - now) : requested ? 0 : interval;
    },
    schedule(delay: number, work: (due: number) => void) {
      if (phase !== "active" || options.autoStart === false) return;
      cancelTimer();
      delay = Math.max(delay, failureRetryAt - Date.now());
      const revision = generation, due = Date.now() + delay;
      timer = setTimeout(() => { timer = undefined; if (current(revision)) work(due); }, Math.min(delay, activeInterval));
      timer.unref();
    },
    run(work: (current: () => boolean) => Promise<void>) {
      if (phase === "stopped") return Promise.reject(new Error("Bridge replicator is stopped"));
      if (phase === "paused") return Promise.reject(new Error("Bridge replication is paused"));
      if (inFlight) return inFlight;
      const revision = generation;
      // Own the promise before subscriptions or status callbacks can reenter.
      inFlight = Promise.resolve().then(() => current(revision) ? work(() => current(revision)) : undefined)
        .finally(() => { inFlight = undefined; });
      return inFlight;
    },
    async pause() {
      if (phase === "stopped") return;
      phase = "paused"; generation++; cancelTimer(); await inFlight?.catch(() => {});
    },
    resume() { if (phase !== "stopped") phase = "active"; },
    stop(cleanup: (pending: Promise<void> | undefined) => Promise<void>) {
      if (stopping) return stopping;
      phase = "stopped"; generation++; cancelTimer();
      const request = Promise.resolve().then(() => cleanup(inFlight));
      stopping = request;
      void request.catch(() => { if (stopping === request) stopping = undefined; });
      return request;
    },
  };
}
