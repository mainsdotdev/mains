import { useCallback, useMemo, useSyncExternalStore } from "react";
import { lastActivityLine } from "../lib/background-runs";
import { plainActivityText, runActivityStore } from "../lib/run-activity";

/** Both surfaces read the same foreground status; the dock updates at a readable pace. */
export function useBackgroundRunActivity(runIds: string[]): Record<string, string> {
  const subscribe = useCallback((listener: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = runActivityStore.subscribe(() => {
      timer ??= setTimeout(() => { timer = undefined; listener(); }, 700);
    });
    return () => { off(); if (timer !== undefined) clearTimeout(timer); };
  }, []);
  const snapshot = useSyncExternalStore(subscribe, runActivityStore.getSnapshot);
  const watchedKey = runIds.join(",");
  return useMemo(() => {
    const lines: Record<string, string> = {};
    for (const runId of watchedKey ? watchedKey.split(",") : []) {
      const streams = snapshot.get(runId);
      const status = streams?.find((stream) => stream.kind === "thinking") ?? streams?.find((stream) => stream.kind === "tool_progress");
      const line = status && lastActivityLine(plainActivityText(status.content));
      if (line) lines[runId] = line;
    }
    return lines;
  }, [snapshot, watchedKey]);
}
