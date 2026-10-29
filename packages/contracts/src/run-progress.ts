import type { RunTurnResponse } from "./runs";

export interface StructuralPlanSnapshot {
  providerTurnId: string;
  explanation?: string;
  steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
  updatedAt?: number;
}

export function parseStructuralPlanSnapshot(value: unknown): StructuralPlanSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.providerTurnId !== "string" || !Array.isArray(candidate.steps)) return null;
  const steps = candidate.steps.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.step !== "string" || (entry.status !== "pending" && entry.status !== "in_progress" && entry.status !== "completed")) return [];
    return [{ step: entry.step, status: entry.status as StructuralPlanSnapshot["steps"][number]["status"] }];
  });
  return {
    providerTurnId: candidate.providerTurnId, steps,
    ...(typeof candidate.explanation === "string" ? { explanation: candidate.explanation } : {}),
    ...(typeof candidate.updatedAt === "number" ? { updatedAt: candidate.updatedAt } : {}),
  };
}

/** Persisted turn identity wins; legacy rows use an unambiguous chronological boundary. */
export function historyEntryTurn<T extends Pick<RunTurnResponse, "id" | "startedAt" | "createdAt">>(
  turns: readonly T[], at: number, turnId?: number,
): T | undefined {
  if (turnId !== undefined) return turns.find((turn) => turn.id === turnId);
  let closest: T | undefined;
  let time = -Infinity;
  let tied = false;
  for (const turn of turns) {
    const start = (turn.startedAt ?? turn.createdAt).getTime();
    if (!Number.isFinite(start) || start > at || start < time) continue;
    if (start === time) { tied = true; continue; }
    closest = turn;
    time = start;
    tied = false;
  }
  return tied ? undefined : closest;
}
