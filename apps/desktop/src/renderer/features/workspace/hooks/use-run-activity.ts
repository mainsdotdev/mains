import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunEphemeralEvent, RunStatusChangedEvent } from "@mains/contracts/runs";
import { getTransport, onTransportChange, type Transport } from "@/lib/transport";
import { runActivityStore } from "../lib/run-activity";

/** One app-scoped subscription, independent of which chat or sidebar is mounted. */
export function useRunActivityLifecycle() {
  useLayoutEffect(() => {
    let release: (() => void) | undefined;
    const bind = (transport: Transport) => {
      release?.();
      runActivityStore.reset();
      let alive = true;
      const current = () => alive && getTransport() === transport && transport.status() === "connected";
      const offStream = transport.subscribe(CHANNELS.runs.ephemeralEvent, (data) => {
        if (current()) runActivityStore.receive(data as RunEphemeralEvent);
      });
      const offRun = transport.subscribe(CHANNELS.runs.statusChanged, (data) => {
        if (!current()) return;
        const { runId, status } = data as RunStatusChangedEvent;
        runActivityStore.statusChanged(runId, status);
      });
      const offStatus = transport.onStatusChange((status) => {
        if (alive && getTransport() === transport && status !== "connected") runActivityStore.reset();
      });
      release = () => { alive = false; offStream(); offRun(); offStatus(); };
    };
    bind(getTransport());
    const offChange = onTransportChange(bind);
    return () => { offChange(); release?.(); runActivityStore.reset(); };
  }, []);
}

export function useRunActivity(runId: string | null) {
  const subscribe = useCallback((listener: () => void) => {
    let frame: number | undefined;
    const off = runActivityStore.subscribe(() => {
      frame ??= requestAnimationFrame(() => { frame = undefined; listener(); });
    });
    return () => { off(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, []);
  const getSnapshot = useCallback(() => runActivityStore.getRun(runId), [runId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
