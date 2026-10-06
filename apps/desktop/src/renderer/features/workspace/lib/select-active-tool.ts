import type { RunEvent } from "../types";

/** The latest foreground tool still in flight in the current turn. */
export function selectActiveTool(events: readonly RunEvent[]): RunEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const metadata = event.metadata;
    if (metadata?.parentToolCallId || metadata?.isFromSubagent) continue;

    // Transient messages are appended after database events, regardless of
    // when they began. An assistant stream therefore cannot settle a tool;
    // its explicit lifecycle status does. Only a new persisted prompt bounds
    // the current turn.
    if (event.type === "artifact" && metadata?.kind === "user-prompt" &&
      metadata?.streaming !== true) {
      return undefined;
    }

    if (event.type === "tool_call" &&
      (metadata?.status === "running" || metadata?.status === "queued")) {
      return event;
    }
  }
  return undefined;
}
