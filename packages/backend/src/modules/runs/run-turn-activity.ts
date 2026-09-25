import { safeJsonParse } from "../../db/utils";
import { runsRepo } from "./runs.repo";
import type { TurnFileChange } from "./runs.dto";

export interface WorkspaceTurnChange {
  id: string;
  runId: string;
  turnId: number;
  files: TurnFileChange[];
  undoneAt: Date | null;
  createdAt: Date;
}

/** Workspace timeline read surface over the runs-owned turn change records. */
export const runTurnActivityService = {
  async listByWorkspace(
    workspaceId: string,
    limit: number,
  ): Promise<WorkspaceTurnChange[]> {
    const rows = await runsRepo.findTurnChangesByWorkspace(workspaceId, limit);

    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      turnId: row.turnId,
      files: safeJsonParse<TurnFileChange[]>(row.filesJson) ?? [],
      undoneAt: row.undoneAt,
      createdAt: row.endedAt ?? row.createdAt,
    }));
  },

  /** Legacy run-end diff entries are superseded when a run has turn changes. */
  async runsWithChanges(runIds: string[]): Promise<Set<string>> {
    if (runIds.length === 0) return new Set();
    const rows = await runsRepo.findRunIdsWithTurnChanges(runIds);
    return new Set(rows.map((row) => row.runId));
  },
};
