import type { RunEvent } from "../types";
import type { StreamingEvent } from "../hooks/use-streaming-events";

/** One reconciliation path for ordinary and assistant conversations. */
export function mergeTranscriptStreams(dbEvents: RunEvent[], streamingEvents: StreamingEvent[], historical: boolean): RunEvent[] {
  if (historical || streamingEvents.length === 0) return dbEvents;

  // Prefer a native stream identity when the provider persists one. The final
  // text can differ from the last delta, or repeat a previous turn's text.
  const dbArtifactStreamIds = new Set(
    dbEvents.filter((e) => e.type === "artifact").map((e) => e.metadata?.streamId),
  );
  // Providers without a persisted stream identity still reconcile by content.
  const dbArtifactContents = new Set(
    dbEvents
      .filter((e) => e.type === "artifact" && e.metadata?.kind === "report")
      .map((e) => e.content.trim()),
  );

  const activeStreams = streamingEvents.filter(
    (se) => !dbArtifactStreamIds.has(se.streamId) &&
      (se.metadata?.streamId === se.streamId || !dbArtifactContents.has(se.content.trim())),
  );

  if (activeStreams.length === 0) return dbEvents;

  const streamRunEvents: RunEvent[] = activeStreams.map((se) => {
    // Command progress and provider thoughts stay out of assistant bubbles;
    // command stdout must never be mistaken for a reasoning summary.
    const kind =
      se.kind === "user-prompt" ? "user-prompt"
        : se.kind === "image_generation" ? "image_generation"
        : se.kind === "thinking" ? "thinking"
        : se.kind === "tool_progress" ? "tool_progress"
        : se.streamId.startsWith("cursor-think-") ? "thinking"
        : se.streamId.startsWith("codex-cmd-") ? "tool_progress"
        : se.streamId.startsWith("claude-think-") ? "thinking"
        : "report";
    return {
      id: se.id,
      type: "artifact" as const,
      content: se.content,
      timestamp: new Date(se.timestamp),
      metadata: {
        ...se.metadata,
        kind,
        streaming: se.metadata?.streaming !== false,
        streamId: se.streamId,
      },
    };
  });

  const merged = [...dbEvents, ...streamRunEvents];
  // A spoken message stays where speech began, even if work artifacts finish
  // before its final transcript. Persisted voice messages keep this timestamp.
  if (activeStreams.some((event) => event.metadata?.voice === true)) {
    merged.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  return merged;
}
