interface RunStatusLike {
  id: string;
  status: string;
}

export interface RunStatusSyncPolicy {
  listen: boolean;
  targetRunId: (eventRunId: string, eventStatus?: string) => string | null;
}

function isPending(status: string | undefined): boolean {
  return status === "running" || status === "queued";
}

/**
 * Status-event routing policy extracted from the workspace hook.
 *
 * Run lifecycle belongs to the workspace, not the selected tab. Keep the
 * status listener alive while any run is open: a pending run can finish, and a
 * settled one can be continued from somewhere this window did not start it (an
 * MCP App message, another window, a remote client). Events route to pending
 * runs, and to a settled run only when it starts running again.
 */
export function createRunStatusSyncPolicy(
  runs: RunStatusLike[],
): RunStatusSyncPolicy {
  const statusById = new Map(runs.map((run) => [run.id, run.status]));

  return {
    listen: statusById.size > 0,
    targetRunId: (eventRunId, eventStatus) => {
      if (!statusById.has(eventRunId)) return null;
      return isPending(statusById.get(eventRunId)) || isPending(eventStatus)
        ? eventRunId
        : null;
    },
  };
}
