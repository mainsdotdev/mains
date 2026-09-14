import type { ToolCallRow } from "@/db/schema";

import { formatDuration } from "./format";
import { parseToolInput, toolFilePath } from "./tool-output";
import { resolveTool, toPresentTense } from "./tool-registry";

/**
 * Folding a run of tool calls into one line.
 *
 * The desktop's `groupConsecutiveToolCalls` collapses a stretch of tool calls
 * into per-tool accordions inside a "12 tool calls (Read, Bash)" header, and
 * `AgentTurnMessagesAccordion` hides the whole stretch once the turn has spoken.
 * A phone has neither the width for two nesting levels nor the room to show
 * thirty rows, so the two ideas merge here into one: a stretch of tool calls is
 * a single line that opens.
 *
 * The one piece of the desktop's logic ported verbatim is the edit collapse —
 * an agent that edits the same file three times in a row has made one change,
 * not three, and each call already carries the full before/after.
 */

export interface ToolBlockSummary {
  /** The row's head: "Worked for 24s", or what is happening right now. */
  label: string;
  /** SF Symbol for the head — the running tool's, or a generic one. */
  symbol: string;
  /** "Read, Bash, Edit +2" — which tools this stretch used. */
  tools: string;
  running: boolean;
}

/** `startedAt` is not always set; `createdAt` always is. */
function beganAt(call: ToolCallRow): number {
  return (call.startedAt ?? call.createdAt).getTime();
}

function isRunning(call: ToolCallRow): boolean {
  return call.status === "running" || call.status === "queued";
}

/**
 * Collapse consecutive Edit/Write calls on the same file into one cumulative
 * row: the first call's `old_string` (the file as it was) and the last one's
 * `new_string` (as it ended up), so the diff spans the whole stretch.
 */
export function mergeToolCalls(calls: ToolCallRow[]): ToolCallRow[] {
  const out: ToolCallRow[] = [];
  const indexByFile = new Map<string, number>();

  for (const call of calls) {
    const kind = resolveTool(call.toolName).kind;
    if (kind !== "edit" && kind !== "write") {
      // Any other tool between two edits breaks the streak — a later edit to
      // the same file is then a separate, visible step.
      indexByFile.clear();
      out.push(call);
      continue;
    }

    const params = parseToolInput(call.inputJson);
    const path = toolFilePath(params);
    if (!path) {
      out.push(call);
      continue;
    }

    const existing = indexByFile.get(path);
    if (existing === undefined) {
      indexByFile.set(path, out.length);
      out.push(call);
      continue;
    }

    const previous = out[existing];
    const previousParams = parseToolInput(previous.inputJson);
    out[existing] = {
      ...previous,
      status: call.status,
      error: call.error ?? previous.error,
      endedAt: call.endedAt ?? previous.endedAt,
      updatedAt: call.updatedAt,
      // The output is the newer one's: it describes the file's final state.
      outputJson: call.outputJson ?? previous.outputJson,
      inputJson: JSON.stringify({
        ...params,
        old_string: previousParams.old_string ?? params.old_string,
        old_str: previousParams.old_str ?? params.old_str,
        new_string: params.new_string ?? previousParams.new_string,
        new_str: params.new_str ?? previousParams.new_str,
      }),
    };
  }

  return out;
}

/** How a folded stretch of tool calls reads when closed. */
export function summarizeToolBlock(calls: ToolCallRow[]): ToolBlockSummary {
  const active = calls.find(isRunning);

  const names: string[] = [];
  for (const call of calls) {
    const name = resolveTool(call.toolName).displayName;
    if (!names.includes(name)) names.push(name);
  }
  const tools = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");

  if (active) {
    const resolved = resolveTool(active.toolName);
    return {
      label: `${toPresentTense(resolved.verb)}…`,
      symbol: resolved.symbol,
      tools,
      running: true,
    };
  }

  // Settled: how long the whole stretch took, when both ends are known.
  const first = calls.reduce((min, c) => Math.min(min, beganAt(c)), Infinity);
  const last = calls.reduce(
    (max, c) => (c.endedAt ? Math.max(max, c.endedAt.getTime()) : max),
    -Infinity,
  );
  const elapsed = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;

  return {
    label:
      elapsed !== null && elapsed >= 1000
        ? `Worked for ${formatDuration(elapsed)}`
        : `${calls.length} tool call${calls.length === 1 ? "" : "s"}`,
    symbol: "wrench.and.screwdriver",
    tools,
    running: false,
  };
}
