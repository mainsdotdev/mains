import { CHANNELS } from "@mains/contracts/channels";
import type { PublishRunQueuePayload } from "@mains/contracts/run-queue-projection";
import type { RunQueueState } from "@/lib/redux/slices/runQueueSlice";
import type { Transport } from "@/lib/transport/types";

interface Dependencies {
  getState: () => { runQueue: RunQueueState; backends: { activeBackendId: string | null } };
  getTransport: () => Transport;
}
const preview = (value: string, limit: number) => Array.from(value).slice(0, limit).join("");

/** Publish display metadata only. Files, settings and the queue consumer stay in their original renderer. */
export function createRunQueuePublisher(deps: Dependencies) {
  const producerId = crypto.randomUUID();
  let revision = 0, alive = true, backendId = "";
  let transport: Transport | undefined, flushID: symbol | undefined;
  const pending = new Map<string, PublishRunQueuePayload>();
  const fingerprints = new Map<string, string>();
  const known = new Set<string>();
  function current(candidate: Transport) {
    return alive && candidate === deps.getTransport() && backendId === (deps.getState().backends.activeBackendId ?? "local") && candidate.status() === "connected";
  }
  async function flush() {
    if (flushID || !transport) return;
    const ticket = Symbol(), candidate = transport; flushID = ticket;
    while (flushID === ticket && current(candidate) && pending.size) {
      const [id, payload] = pending.entries().next().value!;
      pending.delete(id);
      const fingerprint = JSON.stringify([payload.messages, payload.pauseReason]);
      try {
        const result = await candidate.invoke(CHANNELS.runs.publishQueue, [payload]);
        if (!result.success && fingerprints.get(id) === fingerprint) fingerprints.delete(id);
      } catch { if (fingerprints.get(id) === fingerprint) fingerprints.delete(id); }
    }
    if (flushID === ticket) flushID = undefined;
  }
  function sync(heartbeat = false) {
    if (!alive) return;
    const candidate = deps.getTransport(), selected = deps.getState().backends.activeBackendId ?? "local";
    if (candidate !== transport || selected !== backendId) {
      transport = candidate; backendId = selected; flushID = undefined;
      pending.clear(); fingerprints.clear(); known.clear();
    }
    if (!current(candidate)) return;
    const queues = Object.values(deps.getState().runQueue.byOwner).filter(queue => queue.backendId === selected);
    const snapshots = queues.map(queue => ({ runId: queue.runId,
      messages: queue.messages.slice(0, 32).map(message => ({ id: message.id, text: preview(message.text, 1024), status: message.status,
        attachmentNames: message.attachmentNames.slice(0, 5).map(name => preview(name.split(/[\\/]/).pop() ?? "Attachment", 120)),
        ...(message.error ? { error: preview(message.error, 512) } : {}) })),
      ...(queue.pauseReason ? { pauseReason: preview(queue.pauseReason, 512) } : {}),
    }));
    const present = new Set(snapshots.map(snapshot => snapshot.runId));
    for (const runId of known) if (!present.has(runId)) snapshots.push({ runId, messages: [] });
    for (const snapshot of snapshots) {
      if (!snapshot.messages.length && !known.has(snapshot.runId)) continue;
      const fingerprint = JSON.stringify([snapshot.messages, snapshot.pauseReason]);
      if (fingerprints.get(snapshot.runId) === fingerprint && !(heartbeat && snapshot.messages.length)) continue;
      known.add(snapshot.runId); fingerprints.set(snapshot.runId, fingerprint);
      pending.set(snapshot.runId, { ...snapshot, producerId, revision: ++revision });
    }
    void flush();
  }
  function dispose() {
    alive = false; flushID = undefined; pending.clear();
    if (transport?.status() === "connected") {
      for (const runId of known) void transport.invoke(CHANNELS.runs.publishQueue, [{ runId, producerId, revision: ++revision, messages: [] }]).catch(() => {});
    }
  }
  return { sync, dispose };
}
