import type { RunTurnResponse } from "@mains/contracts/runs";
import type { RunTurnRow } from "../db/schema";

function date(value: unknown): Date | null {
  const parsed = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Turn bodies and patches stay on the backend; this is window-scoped execution metadata. */
export function turnRow(backendId: string, turn: RunTurnResponse): RunTurnRow {
  return {
    backendId, runId: turn.runId, turnIndex: turn.turnIndex, id: turn.id,
    promptContent: null, responseContent: null,
    status: turn.status, startedAt: date(turn.startedAt), endedAt: date(turn.endedAt),
    elapsedMs: turn.elapsedMs, model: turn.model, createdAt: date(turn.createdAt),
    metadataJson: turn.metadata?.codexPlan ? JSON.stringify({ codexPlan: turn.metadata.codexPlan }) : null,
    changesJson: turn.changes ? JSON.stringify(turn.changes) : null,
  };
}
