interface RunStatusLike {
  id: string;
  status: string;
}

export interface RunStatusSyncPolicy {
  listen: boolean;
  targetRunId: (eventRunId: string) => string | null;
}

/**
 * Status-event routing policy extracted from the workspace hook.
 *
 * Run lifecycle belongs to the workspace, not the selected tab. Keep the
 * status listener alive while any open run can still transition, and route
 * events only to those pending runs.
 */
export function createRunStatusSyncPolicy(
  runs: RunStatusLike[],
): RunStatusSyncPolicy {
  const pendingRunIds = new Set(
    runs
      .filter((run) => run.status === "running" || run.status === "queued")
      .map((run) => run.id),
  );

  return {
    listen: pendingRunIds.size > 0,
    targetRunId: (eventRunId) =>
      pendingRunIds.has(eventRunId) ? eventRunId : null,
  };
}
