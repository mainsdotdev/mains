import { useEffect, useRef } from "react";
import { appEvents } from "@/lib/transport";

/**
 * Re-run `onBurst` when the given run persists new events, coalesced so a
 * burst of events (a subagent's own tool calls, streamed artifacts) costs one
 * round trip instead of one per event. The live-refresh idiom every
 * run-scoped view shares — extracted so the delay and the coalescing rule
 * can't drift between copies.
 */
export function useRunEventRefetch(
  runId: string | null | undefined,
  onBurst: () => void,
  delayMs = 1500,
): void {
  // Latest-callback ref: the subscription itself must not churn when a caller
  // passes a fresh closure every render.
  const onBurstRef = useRef(onBurst);
  useEffect(() => {
    onBurstRef.current = onBurst;
  });

  useEffect(() => {
    if (!runId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = appEvents.runs.onEventPersisted((data) => {
      if (data.runId !== runId || timer) return;
      timer = setTimeout(() => {
        timer = null;
        onBurstRef.current();
      }, delayMs);
    });
    return () => {
      cleanup();
      if (timer) clearTimeout(timer);
    };
  }, [runId, delayMs]);
}
