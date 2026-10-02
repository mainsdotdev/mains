import { useEffect } from "react";
import { store } from "@/lib/redux";
import { getTransport, onTransportChange } from "@/lib/transport";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunStatus } from "@/lib/redux/api/runsApi";
import { runMessageQueue } from "../lib/run-message-queue";

/** The app owns the consumer so queued messages survive route/tab unmounts. */
export function useRunMessageQueueController(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let scheduled = false;
    let alive = true;
    let previousQueues = store.getState().runQueue;
    let previousBackend = store.getState().backends.activeBackendId ?? "local";
    const kick = () => {
      if (!alive || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (alive) void runMessageQueue.pump();
      });
    };
    let releaseTransport = () => {};
    const bind = () => {
      releaseTransport();
      const transport = getTransport();
      const backendId = store.getState().backends.activeBackendId ?? "local";
      const releaseStatus = transport.subscribe(CHANNELS.runs.statusChanged, (payload) => {
        const { runId, status } = payload as { runId: string; status: RunStatus };
        runMessageQueue.onStatus(backendId, runId, status);
        kick();
      });
      const releaseConnection = transport.onStatusChange((status) => {
        if (status !== "connected") runMessageQueue.pauseBackend(backendId, "Backend disconnected. Queued messages are paused.");
        else kick();
      });
      releaseTransport = () => { releaseStatus(); releaseConnection(); };
      kick();
    };
    const unsubscribeStore = store.subscribe(() => {
      const state = store.getState();
      const backendId = state.backends.activeBackendId ?? "local";
      if (backendId !== previousBackend) {
        const old = previousBackend;
        previousBackend = backendId;
        runMessageQueue.pauseBackend(old, "Backend changed. Queued messages are paused.");
        bind();
      }
      if (previousQueues !== state.runQueue) { previousQueues = state.runQueue; kick(); }
    });
    const unsubscribeTransport = onTransportChange(() => {
      runMessageQueue.pauseBackend(previousBackend, "Backend connection changed. Queued messages are paused.");
      bind();
    });
    bind();
    const poll = window.setInterval(kick, 10_000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      unsubscribeStore(); unsubscribeTransport(); releaseTransport();
    };
  }, [enabled]);
}
