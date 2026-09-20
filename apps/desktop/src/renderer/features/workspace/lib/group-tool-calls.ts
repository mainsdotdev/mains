import type { RunEvent } from "../types";
import { resolveTool } from "./resolve-tool";

/**
 * Collapse consecutive Edit events targeting the same file into one entry.
 * Cursor (and other agents) often emit multiple edits to the same file back-to-back;
 * each edit carries the full old→new snapshot, so showing them all as separate
 * rows is misleading. Keep the first `old_string` (original file state) and the
 * last `new_string` (final state) so the diff is cumulative.
 */
function getEventInput(event: RunEvent): Record<string, unknown> | null {
  const raw = event.metadata?.input;
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function collapseEditsByFilePath(events: RunEvent[]): RunEvent[] {
  const result: RunEvent[] = [];
  const indexByFile = new Map<string, number>();

  for (const event of events) {
    const input = getEventInput(event);
    if (!input || typeof input.file_path !== "string") {
      result.push(event);
      continue;
    }
    const filePath = input.file_path;

    const existingIdx = indexByFile.get(filePath);
    if (existingIdx === undefined) {
      indexByFile.set(filePath, result.length);
      result.push(event);
      continue;
    }

    const prev = result[existingIdx];
    const prevInput = getEventInput(prev) ?? {};
    const mergedInput: Record<string, unknown> = {
      ...input,
      file_path: filePath,
      old_string: prevInput.old_string ?? input.old_string,
      new_string: input.new_string ?? prevInput.new_string,
    };

    const toolName =
      (event.metadata?.toolName as string | undefined) ??
      event.content.split(":")[0];

    result[existingIdx] = {
      ...prev,
      content: `${toolName}: ${JSON.stringify(mergedInput)}`,
      timestamp: event.timestamp,
      metadata: {
        ...prev.metadata,
        input: mergedInput,
      },
    };
  }

  return result;
}

/**
 * Backwards-compatible accessor — returns the resolved displayName for an
 * event's content. Callers that need classification should use
 * `resolveTool(content).groupKey` directly.
 */
export function getToolType(content: string): string {
  return resolveTool(content).displayName;
}

/**
 * Strip Task plan tool calls (TaskCreate/TaskUpdate) out of the timeline.
 *
 * Each call is an incremental edit to the plan; rendering them inline produces
 * a noisy, repetitive timeline. Instead, the aggregated plan is surfaced as the
 * toast-style `<TodoSummaryBar />` pinned to the top of the viewport, so the
 * in-message cards become redundant.
 */
function stripTaskPlanEvents(events: RunEvent[]): RunEvent[] {
  return events.filter(
    (event) => resolveTool(event.content).groupKey !== "task-plan",
  );
}

export function prepareToolCalls(events: RunEvent[]): RunEvent[] {
  // Pre-process: drop Task plan events — the pinned summary bar above the
  // input is the single source of truth for plan state.
  const processedEvents = stripTaskPlanEvents(events);

  const preparedEvents: RunEvent[] = [];
  let currentEdits: RunEvent[] = [];
  let currentEditKey: "edit" | "write" | null = null;

  const flushEdits = () => {
    if (currentEdits.length === 0) return;
    preparedEvents.push(...collapseEditsByFilePath(currentEdits));
    currentEdits = [];
    currentEditKey = null;
  };

  for (const event of processedEvents) {
    const groupKey = resolveTool(event.content).groupKey;
    const editKey =
      groupKey === "edit" || groupKey === "write" ? groupKey : null;

    if (editKey === null) {
      flushEdits();
      preparedEvents.push(event);
      continue;
    }

    if (currentEditKey !== editKey) {
      flushEdits();
      currentEditKey = editKey;
    }
    currentEdits.push(event);
  }

  flushEdits();
  return preparedEvents;
}
