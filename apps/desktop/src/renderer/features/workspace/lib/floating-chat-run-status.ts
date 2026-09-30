import { formatRunElapsed, lastActivityLine } from "./background-runs";
import type { Run, RunEvent } from "../types";

function latestRunActivity(events: RunEvent[], liveOnly = false): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (liveOnly && event.metadata?.streaming !== true) continue;
    if (event.metadata?.isFromSubagent || !event.content.trim()) continue;
    const kind = event.metadata?.kind;
    if (
      event.type === "artifact" &&
      (kind === "thinking" || kind === "response" || kind === "text" || kind === "report")
    ) {
      const line = lastActivityLine(event.content);
      if (line) return line.replace(/\s+/g, " ");
    }
    if (event.type === "log" && event.content.startsWith("[thinking] ")) {
      const line = lastActivityLine(event.content.slice("[thinking] ".length));
      if (line) return line.replace(/\s+/g, " ");
    }
  }
  return null;
}

/** The compact composer shows the selected run's progress while it is active. */
export function floatingChatRunStatus(
  events: RunEvent[],
  run: Run | null,
  nowMs: number,
): string | null {
  if (run?.status !== "running" && run?.status !== "queued") return null;
  if (run.status === "queued") {
    return `Queued · ${run.title?.trim() || run.goal?.trim() || "Waiting to start"}`;
  }
  const elapsed = formatRunElapsed(run, nowMs);
  // Older transcript rows can belong to a previous turn. The compact bar
  // mirrors the background card's live activity line instead.
  const activity = latestRunActivity(events, true);
  return `Working for ${elapsed}${activity ? ` · ${activity}` : ""}`;
}
