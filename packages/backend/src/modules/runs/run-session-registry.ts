import type { RunSession, RunSessionResult } from "./run-session";

const activeSessions = new Map<string, RunSession>();

export const runSessionRegistry = {
  register(runId: string, session: RunSession): void {
    activeSessions.set(runId, session);
  },

  unregister(runId: string): void {
    activeSessions.delete(runId);
  },

  get(runId: string): RunSession | undefined {
    return activeSessions.get(runId);
  },

  active(): IterableIterator<RunSession> {
    return activeSessions.values();
  },

  /**
   * Force-finalize every active session with `status: "failed"`.
   * Called on app shutdown so running runs don't sit as `status: "running"`
   * across an app restart.
   *
   * Fire-and-forget by design — each session's finalize is idempotent and
   * handles its own errors; the caller (before-quit hook) cannot await
   * arbitrarily long DB writes.
   */
  shutdownAll(reason: string = "App quit during run"): void {
    const result: RunSessionResult = { status: "failed", summary: reason };
    for (const session of activeSessions.values()) {
      void session.finalize(result);
    }
  },
};
