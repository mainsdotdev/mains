import type { BridgeRunState } from "@mains/contracts/bridge";

interface WatchedRun { value: BridgeRunState }
const leaseMs = 90_000;

/** View leases and stream readiness have different lifetimes. A pull ticket
 * belongs to one watch incarnation, even when the run id is reopened. */
export function createBridgeRunWatches() {
  const views = new Map<string, { runId: string; expires: number }>();
  const runs = new Map<string, WatchedRun>();
  let stopped = false;
  function active() {
    const now = Date.now();
    for (const [id, view] of views) if (view.expires <= now) views.delete(id);
    const ids = new Set([...views.values()].map((view) => view.runId));
    for (const id of runs.keys()) if (!ids.has(id)) runs.delete(id);
    return [...ids].sort();
  }
  return {
    ids: active,
    watch(runId: string, viewId: string, local: boolean, cached: () => boolean) {
      if (stopped) throw new Error("Bridge replicator is stopped");
      const before = active().join(",");
      if (local) views.delete(viewId);
      else {
        if (views.size >= 512 && !views.has(viewId)) throw new Error("Too many open Bridge views");
        const targets = new Set([...views].filter(([id]) => id !== viewId).map(([, view]) => view.runId));
        targets.add(runId);
        if (targets.size > 127) throw new Error("Too many open Bridge streams");
        views.set(viewId, { runId, expires: Date.now() + leaseMs });
        if (!runs.has(runId)) runs.set(runId, { value: { runId, ready: cached(), error: null } });
      }
      return before !== active().join(",");
    },
    unwatch(viewId: string) {
      const before = active().join(","); views.delete(viewId);
      return before !== active().join(",");
    },
    snapshot(): WatchedRun[] { return active().map((id) => runs.get(id)!); },
    current(ticket: WatchedRun) { active(); return !stopped && runs.get(ticket.value.runId) === ticket; },
    ready(ticket: WatchedRun) {
      active();
      if (!stopped && runs.get(ticket.value.runId) === ticket) ticket.value = { ...ticket.value, ready: true, error: null };
    },
    fail(tickets: WatchedRun[], error: string) {
      active();
      for (const ticket of tickets) if (!stopped && runs.get(ticket.value.runId) === ticket) ticket.value = { ...ticket.value, error };
    },
    status() { active(); return [...runs.values()].map(({ value }) => ({ ...value })); },
    stop() { stopped = true; views.clear(); runs.clear(); },
  };
}
