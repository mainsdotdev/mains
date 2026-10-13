import { useEffect } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  runsApi,
  useGetAccountQuery,
  useListRecentRunsQuery,
} from "@/lib/redux/api";
import { appEvents } from "@/lib/transport";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useModeConfig } from "@/hooks/use-mode-config";

const STATUS_REFRESH_INTERVAL_MS = 10_000;

/**
 * The chat sidebar's data: recent runs of the active space's mode, refreshed
 * live — `runs:updated` delivers the generated title seconds after a run
 * starts, `runs:statusChanged` flips the running dot. Recheck pending runs
 * after a missed push, and catch up when returning from another sidebar.
 */
export function useRecentChats() {
  const dispatch = useAppDispatch();
  const { activeSpace } = useActiveSpace();
  const { data: account } = useGetAccountQuery();
  const { mode } = useModeConfig();
  const canQuery = !!activeSpace && !!account;
  const query = useListRecentRunsQuery(
    {
      accountId: account?.id ?? "",
      providerId: activeSpace?.providerId ?? "",
      mode,
    },
    { skip: !canQuery, refetchOnMountOrArgChange: true },
  );
  const { refetch } = query;
  const hasPendingRuns = query.currentData?.some(
    (run) => run.status === "running" || run.status === "queued",
  ) ?? false;

  useEffect(() => {
    const invalidate = ({ runId }: { runId: string }) => {
      // The titlebar shares the run cache with the chat actions menu.
      dispatch(runsApi.util.invalidateTags(["RunsRecent", { type: "Runs", id: runId }]));
      // Tag invalidation waits for every pending API request. A slow provider
      // lookup must not delay this list's status refresh.
      if (canQuery) void refetch();
    };
    const offUpdated = appEvents.runs.onUpdated(invalidate);
    const offStatusChanged = appEvents.runs.onStatusChanged(invalidate);
    return () => {
      offUpdated();
      offStatusChanged();
    };
  }, [dispatch, canQuery, refetch]);

  useEffect(() => {
    if (!hasPendingRuns) return;
    const timer = setInterval(() => { void refetch(); }, STATUS_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasPendingRuns, refetch]);

  // RTK Query's `data` can retain the previous args while a provider/mode
  // switch loads. Never flash another experience's chats in the new sidebar.
  return { ...query, data: query.currentData };
}
