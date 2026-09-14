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

/**
 * The chat sidebar's data: recent runs of the active space's mode, refreshed
 * live — `runs:updated` delivers the generated title seconds after a run
 * starts (no polling), `runs:statusChanged` flips the running dot.
 */
export function useRecentChats() {
  const dispatch = useAppDispatch();
  const { activeSpace } = useActiveSpace();
  const { data: account } = useGetAccountQuery();
  const { mode } = useModeConfig();
  const query = useListRecentRunsQuery(
    {
      accountId: account?.id ?? "",
      providerId: activeSpace?.providerId ?? "",
      mode,
    },
    { skip: !activeSpace || !account },
  );

  useEffect(() => {
    const invalidate = () => {
      dispatch(runsApi.util.invalidateTags(["RunsRecent"]));
    };
    const offUpdated = appEvents.runs.onUpdated(invalidate);
    const offStatusChanged = appEvents.runs.onStatusChanged(invalidate);
    return () => {
      offUpdated();
      offStatusChanged();
    };
  }, [dispatch]);

  // RTK Query's `data` can retain the previous args while a provider/mode
  // switch loads. Never flash another experience's chats in the new sidebar.
  return { ...query, data: query.currentData };
}
