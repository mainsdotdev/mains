import type { RunEvent } from "../types";
import { resolveTool } from "./resolve-tool";

export interface ToolSubGroup {
  id: string;
  /** Human-readable label rendered in the accordion header. */
  displayName: string;
  /** Stable comparison key — events sharing this key collapse into one group. */
  groupKey: string;
  /** Icon rendered next to the displayName in the accordion header. */
  icon: React.ReactNode;
  events: RunEvent[];
}

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
 * event's content. Callers that need grouping logic should use
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

export function groupConsecutiveToolCalls(events: RunEvent[]): ToolSubGroup[] {
  // Pre-process: drop Task plan events — the pinned summary bar above the
  // input is the single source of truth for plan state.
  const processedEvents = stripTaskPlanEvents(events);

  const subGroups: ToolSubGroup[] = [];
  let currentGroup: RunEvent[] = [];
  let currentKey: string | null = null;
  let currentLabel = "";
  let currentIcon: React.ReactNode = null;

  const flushGroup = () => {
    if (currentGroup.length === 0 || currentKey === null) return;
    const events =
      currentKey === "edit" || currentKey === "write"
        ? collapseEditsByFilePath(currentGroup)
        : [...currentGroup];
    subGroups.push({
      id: `subgroup-${currentGroup[0].id}`,
      groupKey: currentKey,
      displayName: currentLabel,
      icon: currentIcon,
      events,
    });
    currentGroup = [];
    currentKey = null;
    currentLabel = "";
    currentIcon = null;
  };

  for (const event of processedEvents) {
    const resolved = resolveTool(event.content);

    // MCP vendor tools render their own header (with input preview) via
    // `McpDisplay`, so collapsing consecutive calls into a single accordion
    // hides the per-call input. Keep each MCP call as its own sub-group.
    const isStandalone = resolved.isSpecialGroup || resolved.vendorId !== undefined;
    if (isStandalone) {
      flushGroup();
      subGroups.push({
        id: `subgroup-${event.id}`,
        groupKey: resolved.groupKey,
        displayName: resolved.groupLabel,
        icon: resolved.icon,
        events: [event],
      });
      continue;
    }

    if (resolved.groupKey === currentKey) {
      currentGroup.push(event);
    } else {
      flushGroup();
      currentKey = resolved.groupKey;
      currentLabel = resolved.groupLabel;
      currentIcon = resolved.icon;
      currentGroup = [event];
    }
  }

  flushGroup();
  return subGroups;
}
