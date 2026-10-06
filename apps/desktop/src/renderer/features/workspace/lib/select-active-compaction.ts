import type { RunEvent } from "../types";

/** Only the latest compaction in the current turn can still be in progress. */
export function selectActiveCompaction(events: readonly RunEvent[]): RunEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.metadata?.isFromSubagent) continue;
    if ((event.type === "artifact" && event.metadata?.kind === "user-prompt" &&
      event.metadata?.streaming !== true) ||
      (event.type === "log" && event.metadata?.level === "sdk-user")) return undefined;
    if (event.type === "log" && event.metadata?.source === "context_compaction") {
      return event.metadata.phase === "start" ? event : undefined;
    }
  }
  return undefined;
}
