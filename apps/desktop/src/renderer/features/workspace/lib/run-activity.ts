import { isTerminalRunStatus } from "@mains/contracts/runs";
import type { TranscriptStream } from "@mains/contracts/transcript-stream";

type ActivityKind = "thinking" | "tool_progress";
export interface RunActivityStream extends TranscriptStream {
  id: string;
  type: "artifact";
  kind: ActivityKind;
}

const EMPTY: readonly RunActivityStream[] = [];

/** Provider aliases are normalized before either surface reads live activity. */
export function runActivityKind(event: { kind: string; streamId?: string; metadata?: Record<string, unknown> }): ActivityKind | undefined {
  if (event.metadata?.voice || event.metadata?.isFromSubagent || event.metadata?.parentToolCallId) return undefined;
  if (event.kind === "thinking" || event.kind === "tool_progress") return event.kind;
  if (event.metadata?.source === "agent_thinking_streaming" || /^(codex|claude|cursor)-think-/.test(event.streamId ?? "")) return "thinking";
  if (event.streamId?.startsWith("codex-cmd-")) return "tool_progress";
  return undefined;
}

/** Plain status text shared by the dock and transcript footer. */
export function plainActivityText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .trim();
}

/** Only the current thought/progress per live run, never message bodies or history. */
export function createRunActivityStore() {
  let snapshot: ReadonlyMap<string, readonly RunActivityStream[]> = new Map();
  const listeners = new Set<() => void>();
  // Fence late chunks after completion; continuations re-open the run explicitly.
  const finished = new Set<string>();
  const notify = () => { for (const listener of listeners) listener(); };
  const clearRun = (runId: string) => {
    if (!snapshot.has(runId)) return;
    const next = new Map(snapshot);
    next.delete(runId);
    snapshot = next;
    notify();
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getRun: (runId: string | null) => runId ? snapshot.get(runId) ?? EMPTY : EMPTY,
    receive({ runId, ts, event }: { runId: string; ts: number; event: { kind: string; streamId?: string; content?: string; metadata?: Record<string, unknown> } }) {
      const kind = runActivityKind(event);
      if (!kind || !event.streamId || finished.has(runId)) return;
      const previous = snapshot.get(runId) ?? EMPTY;
      const existing = previous.find((stream) => stream.kind === kind);
      // An old stream's retirement must not erase its replacement.
      if (!event.content?.trim() && existing?.streamId !== event.streamId) return;
      const streams = previous.filter((stream) => stream.kind !== kind);
      if (event.content?.trim()) streams.push({
        id: `stream-${event.streamId}`, type: "artifact", kind, content: event.content,
        metadata: event.metadata, streamId: event.streamId,
        timestamp: existing?.streamId === event.streamId ? existing.timestamp : ts,
      });
      const next = new Map(snapshot);
      if (streams.length) next.set(runId, streams); else next.delete(runId);
      snapshot = next;
      notify();
    },
    finish(runId: string) {
      finished.add(runId);
      if (finished.size > 512) finished.delete(finished.values().next().value!);
      clearRun(runId);
    },
    statusChanged(runId: string, status: string) {
      if (isTerminalRunStatus(status)) this.finish(runId);
      else if (status === "running" || status === "queued") {
        finished.delete(runId);
        clearRun(runId);
      }
    },
    reset() { finished.clear(); snapshot = new Map(); notify(); },
  };
}

export const runActivityStore = createRunActivityStore();
