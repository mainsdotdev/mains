import { historyEntryTurn, parseStructuralPlanSnapshot, type StructuralPlanSnapshot } from "@mains/contracts/run-progress";
import type { RunTurnChangesSummary, RunTurnResponse, TurnFileChange } from "@mains/contracts/runs";
import type { RunTurnRow, ToolCallRow } from "../../../db/schema";
import type { TurnRow } from "../../../lib/transcript-rows";

function record(json: string | null): Record<string, unknown> {
  try {
    const value: unknown = json ? JSON.parse(json) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function readTurnChanges(json: string | null): RunTurnChangesSummary | null {
  const value = record(json);
  if (typeof value.id !== "string" || !Array.isArray(value.files) ||
    typeof value.additions !== "number" || typeof value.deletions !== "number") return null;
  const files = value.files.filter((file): file is TurnFileChange => !!file && typeof file === "object" &&
    typeof file.path === "string" && typeof file.additions === "number" && typeof file.deletions === "number" &&
    ["added", "modified", "deleted", "renamed"].includes(file.status));
  const undoneAt = value.undoneAt ? new Date(String(value.undoneAt)) : null;
  return {
    id: value.id, files, additions: value.additions, deletions: value.deletions,
    truncated: value.truncated === true,
    fileCount: typeof value.fileCount === "number" ? value.fileCount : files.length,
    undoneAt: undoneAt && Number.isFinite(undoneAt.getTime()) ? undoneAt : null,
  };
}

export function readRunTurns(rows: readonly RunTurnRow[]): RunTurnResponse[] {
  return rows.flatMap((row) => row.id === null ? [] : [{
    id: row.id, runId: row.runId, turnIndex: row.turnIndex,
    promptContent: null, responseContent: null,
    status: row.status === "active" ? "active" as const : "completed" as const,
    startedAt: row.startedAt, endedAt: row.endedAt, elapsedMs: row.elapsedMs,
    model: row.model, createdAt: row.createdAt ?? row.startedAt ?? new Date(0),
    metadata: record(row.metadataJson), changes: readTurnChanges(row.changesJson),
  }]).sort((a, b) => a.turnIndex - b.turnIndex);
}

/** Execution progress belongs to the active turn, never to an earlier turn or a child agent. */
export function activeRunPlan(turns: readonly RunTurnResponse[], calls: readonly ToolCallRow[]): StructuralPlanSnapshot | null {
  const turn = turns.at(-1);
  if (!turn || turn.status !== "active") return null;
  const structural = parseStructuralPlanSnapshot(turn.metadata?.codexPlan);
  if (structural) return structural.steps.some((step) => step.status !== "completed") ? structural : null;
  let steps: StructuralPlanSnapshot["steps"] = [];
  const status = (value: unknown): StructuralPlanSnapshot["steps"][number]["status"] =>
    value === "completed" || value === "done" ? "completed" : value === "in_progress" ? "in_progress" : "pending";
  for (const call of [...calls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)) {
    const metadata = record(call.metadataJson);
    if (call.parentToolCallId || metadata.isFromSubagent || metadata.parentToolUseId ||
      historyEntryTurn(turns, call.createdAt.getTime(), typeof metadata.turnId === "number" ? metadata.turnId : undefined)?.id !== turn.id) continue;
    const input = record(call.inputJson);
    const name = call.toolName.toLowerCase();
    if (["updatetodos", "todowrite", "write_todos"].includes(name)) {
      const todos = input.todos ?? input.items;
      if (Array.isArray(todos)) steps = todos.flatMap((todo) => {
        const label = todo?.content ?? todo?.title;
        return typeof label === "string" && label ? [{ step: label, status: status(todo.status) }] : [];
      });
    } else if (name === "taskcreate" && typeof input.subject === "string") {
      steps.push({ step: input.subject, status: "pending" });
    } else if (name === "taskupdate") {
      const index = Number(input.taskId) - 1;
      if (steps[index] && input.status) steps[index] = { ...steps[index], status: status(input.status) };
    }
  }
  return steps.some((step) => step.status !== "completed") ? { providerTurnId: String(turn.id), steps } : null;
}

/** Keep each summary outside the fold and below the last visible item of its own turn. */
export function turnChangeFooters(rows: readonly TurnRow[], turns: readonly RunTurnResponse[], atLatest: boolean) {
  const lastRows = new Map<number, string>();
  let lastAt = -Infinity;
  for (const row of rows) {
    const items = row.kind === "flat" ? row.items : [...row.previous, ...row.breakout, ...row.last];
    for (const item of items) {
      lastAt = Math.max(lastAt, item.at);
      if (item.kind === "prompt") continue;
      const turn = historyEntryTurn(turns, item.at, item.turnId);
      if (turn) lastRows.set(turn.id, row.key);
    }
  }
  const result = new Map<string, RunTurnResponse[]>();
  for (const turn of turns) {
    const key = lastRows.get(turn.id);
    if (!key || turn.status !== "completed" || !turn.changes ||
      (!atLatest && (!turn.endedAt || turn.endedAt.getTime() > lastAt))) continue;
    result.set(key, [...(result.get(key) ?? []), turn]);
  }
  return result;
}
