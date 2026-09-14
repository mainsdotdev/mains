/**
 * "What is it doing right now" for runs the user cannot see.
 *
 * The adapter already broadcasts every streamed chunk to every client
 * (`runs:ephemeralEvent`); this hook keeps only the tail line per watched run
 * and hands it to the dock. Chunks arrive dozens of times a second during a
 * fast turn, so the subscription writes into a ref and a timer flushes it —
 * the dock re-renders at a readable pace, not at the adapter's.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { appEvents } from "@/lib/transport";
import { lastActivityLine } from "../lib/background-runs";

/** How often buffered activity lines reach React state. */
const FLUSH_INTERVAL_MS = 700;

export function useBackgroundRunActivity(
  runIds: string[],
): Record<string, string> {
  const [lines, setLines] = useState<Record<string, string>>({});
  const bufferRef = useRef<Record<string, string>>({});

  // Depend on the ids themselves, not the array identity — the dock rebuilds
  // its list on every refetch and the subscription must not churn with it.
  const watchedKey = runIds.join(",");

  useEffect(() => {
    if (!watchedKey) return;
    const watched = new Set(watchedKey.split(","));

    const off = appEvents.runs.onStreamingEvent(({ runId, event }) => {
      if (!watched.has(runId)) return;
      const line = lastActivityLine(event.content ?? "");
      if (line) bufferRef.current[runId] = line;
    });

    const flush = window.setInterval(() => {
      const buffered = bufferRef.current;
      if (Object.keys(buffered).length === 0) return;
      bufferRef.current = {};
      // Merge and drop finished runs in one pass — the flush is the only place
      // this map is written, so it is also where it stays bounded.
      setLines((prev) =>
        Object.fromEntries(
          Object.entries({ ...prev, ...buffered }).filter(([runId]) =>
            watched.has(runId),
          ),
        ),
      );
    }, FLUSH_INTERVAL_MS);

    return () => {
      off();
      window.clearInterval(flush);
      bufferRef.current = {};
    };
  }, [watchedKey]);

  // Read-side guard: between a run finishing and the next flush, its line is
  // still in state, and no card should show a line for a run that is gone.
  return useMemo(() => {
    const watched = new Set(watchedKey ? watchedKey.split(",") : []);
    return Object.fromEntries(
      Object.entries(lines).filter(([runId]) => watched.has(runId)),
    );
  }, [lines, watchedKey]);
}
