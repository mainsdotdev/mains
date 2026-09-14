import type { ConnectionState } from "@/backend/connection-supervisor";
import { endpointHost } from "@mains/contracts/backend";

export function relativeTime(value: Date | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const ms = now - value.getTime();
  if (ms < 45_000) return "just now";
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
  return value.toLocaleDateString();
}

/** `+286 −5` out of git's shortstat line, the way the desktop's workspace row reads it. */
export function parseShortstat(shortstat: string | null | undefined): {
  additions: number | null;
  deletions: number | null;
} {
  const additions = shortstat?.match(/(\d+) insertion/)?.[1];
  const deletions = shortstat?.match(/(\d+) deletion/)?.[1];
  return {
    additions: additions ? Number(additions) : null,
    deletions: deletions ? Number(deletions) : null,
  };
}

/** Desktop's workspace status names, spelled out. */
export function workspaceStatusLabel(status: string | null | undefined): string | null {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "todo":
      return "Todo";
    case "in_progress":
      return "In progress";
    case "in_review":
      return "In review";
    case "done":
      return "Done";
    case "canceled":
      return "Canceled";
    case "duplicate":
      return "Duplicate";
    default:
      return null;
  }
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}

/** Elapsed time, the way the desktop's `formatDurationMs` spells it. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ${seconds}s`;
}

/** Semantic tone for a connection state; components map tones to colors. */
export type Tone = "accent" | "muted" | "warning" | "dim";

export function connectionTone(state: ConnectionState): Tone {
  switch (state.kind) {
    case "connected":
      return "accent";
    case "connecting":
    case "reconnecting":
    case "syncing":
      return "muted";
    case "unreachable":
    case "authBlocked":
    case "incompatible":
      return "warning";
    default:
      return "dim";
  }
}

export function connectionLabel(state: ConnectionState): string {
  switch (state.kind) {
    case "idle":
      return "Idle";
    case "offline":
      return "Offline";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "syncing":
      return "Syncing";
    case "connected":
      return "Live";
    case "unreachable":
      return "Unreachable";
    case "authBlocked":
      return "Refused";
    case "incompatible":
      return "Incompatible";
  }
}

/** One line under the connection badge: where we are, or what went wrong. */
export function connectionDetail(state: ConnectionState): string | null {
  switch (state.kind) {
    case "connected":
      return `via ${endpointHost(state.endpoint)} · Mains ${state.descriptor.appVersion}`;
    case "connecting":
    case "reconnecting":
    case "syncing":
      return endpointHost(state.endpoint);
    case "unreachable":
    case "authBlocked":
    case "incompatible":
      return state.reason;
    case "offline":
      return "Waiting for a network connection";
    case "idle":
      return null;
  }
}

/** A one-line preview of a tool call's input for the transcript. */
export function toolInputPreview(inputJson: string | null, max = 90): string {
  if (!inputJson) return "";
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const preferred = ["command", "file_path", "path", "pattern", "query", "url", "description"];
      for (const key of preferred) {
        const v = obj[key];
        if (typeof v === "string" && v.length > 0) return truncate(v, max);
      }
      const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
      if (first) return truncate(first, max);
    }
    return truncate(inputJson, max);
  } catch {
    return truncate(inputJson, max);
  }
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
