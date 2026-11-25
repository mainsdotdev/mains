import { randomUUID } from "node:crypto";
import type { WorkRunArtifactEvent } from "../../../shared/adapter.types";
import { isAssistantReportStream } from "../../../shared/report-stream";

interface Report {
  nativeId: string;
  event: WorkRunArtifactEvent;
  persisting: boolean;
  requiresCompletedItem: boolean;
}
const parentReport = (event: WorkRunArtifactEvent) => event.kind === "report" && event.metadata?.isFromSubagent !== true && event.metadata?.voice !== true;

/** A final write owns its snapshot, while a reused native id may already carry
 * the next message. Only its successful commit retires that exact snapshot. */
export function createReportProjection() {
  const scope = randomUUID();
  let sequence = 0;
  const active = new Map<string, Report>();
  const pending = new Map<string, Report>();
  const completed = new Set<string>();
  const lastFinal = new Map<string, { id: string; content?: string }>();

  function stream(event: WorkRunArtifactEvent, turnId: number | null): WorkRunArtifactEvent {
    if (!event.streamId || !isAssistantReportStream(event)) return event;
    const nativeId = event.streamId;
    const previous = active.get(nativeId);
    if (!event.content) {
      if (previous && !previous.persisting) {
        active.delete(nativeId);
        pending.delete(previous.event.streamId!);
      }
      return { ...event, streamId: previous?.event.streamId ?? nativeId };
    }
    const id = previous && !previous.persisting ? previous.event.streamId! : `${nativeId}-${scope}-${++sequence}`;
    const report: Report = {
      nativeId, persisting: false,
      requiresCompletedItem: event.requiresCompletedItem === true,
      event: { ...event, streamId: id, metadata: { ...event.metadata, streamId: id,
        ...(previous?.event.metadata?.turnId !== undefined && !previous.persisting
          ? { turnId: previous.event.metadata.turnId } : turnId !== null ? { turnId } : {}) } },
    };
    pending.set(id, report); active.set(nativeId, report);
    return report.event;
  }

  // Called synchronously at admission, before an async database queue can yield.
  function prepare(event: WorkRunArtifactEvent): WorkRunArtifactEvent {
    if (!parentReport(event)) return event;
    const id = event.streamId ?? event.metadata?.streamId;
    const final = typeof id === "string" ? lastFinal.get(id) : undefined;
    const current = typeof id === "string" ? active.get(id) : undefined;
    if (final?.content === event.content && final && (!current || !event.content?.trim().startsWith(current.event.content?.trim() ?? ""))) {
      return { ...event, streamId: final.id, metadata: { ...event.metadata, streamId: final.id } };
    }
    let report = typeof id === "string" ? pending.get(id) ?? active.get(id) : undefined;
    if (id === undefined && event.content?.trim()) {
      report = [...pending.values()].find((entry) => !entry.requiresCompletedItem && entry.event.content?.trim() &&
        event.content!.trim().startsWith(entry.event.content.trim()));
    }
    if (!report) {
      const final = typeof id === "string" ? lastFinal.get(id) : undefined;
      return final && final.content === event.content
        ? { ...event, metadata: { ...event.metadata, streamId: final.id } } : event;
    }
    report.persisting = true;
    const prepared = { ...event, streamId: report.event.streamId, metadata: {
      ...event.metadata, streamId: report.event.streamId,
      ...(typeof report.event.metadata?.turnId === "number" ? { turnId: report.event.metadata.turnId } : {}),
    } };
    // A failed insert must recover the final text, not its last partial delta.
    report.event = prepared;
    return prepared;
  }

  return {
    stream, prepare,
    completedPreview(event: WorkRunArtifactEvent): WorkRunArtifactEvent | undefined {
      const id = event.streamId;
      if (!parentReport(event) || !id || !pending.get(id)?.requiresCompletedItem) return undefined;
      // Replace the draft as soon as the completed item is available, even
      // while persistence is pending or the reader's history window is frozen.
      return { ...event, ephemeral: true, metadata: {
        ...event.metadata, source: "agent_message_streaming", streaming: false,
      } };
    },
    completed(event: WorkRunArtifactEvent): boolean {
      if (!parentReport(event)) return false;
      const id = event.metadata?.streamId ?? event.streamId;
      return typeof id === "string" && completed.has(id);
    },
    commit(event: WorkRunArtifactEvent): void {
      if (!parentReport(event)) return;
      const id = event.metadata?.streamId ?? event.streamId;
      if (typeof id !== "string") return;
      const report = pending.get(id);
      completed.add(id);
      if (!report) return;
      pending.delete(id);
      if (active.get(report.nativeId) === report) active.delete(report.nativeId);
      lastFinal.set(report.nativeId, { id, content: event.content });
    },
    settle() {
      const recoverable: WorkRunArtifactEvent[] = [];
      const discarded: WorkRunArtifactEvent[] = [];
      for (const [id, report] of pending) {
        if (report.requiresCompletedItem && !report.persisting) {
          pending.delete(id);
          if (active.get(report.nativeId) === report) active.delete(report.nativeId);
          discarded.push({ ...report.event, content: "" });
        } else {
          recoverable.push(report.event);
        }
      }
      return { recoverable, discarded };
    },
  };
}
