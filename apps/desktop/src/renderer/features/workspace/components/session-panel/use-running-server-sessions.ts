import { useMemo } from "react";
import { useGetTerminalSessionsQuery } from "@/lib/redux/api";

export function useRunningServerSessions(enabled: boolean, activeWorkspaceId: string | null) {
  const { currentData: terminals } = useGetTerminalSessionsQuery(undefined, {
    skip: !enabled,
    selectFromResult: ({ currentData }) => ({ currentData }),
  });

  return useMemo(
    () => (terminals ?? [])
      .filter((session) => session.workspaceId && session.status === "running" && (session.servers?.length ?? 0) > 0)
      .sort((a, b) => Number(b.workspaceId === activeWorkspaceId) - Number(a.workspaceId === activeWorkspaceId)),
    [terminals, activeWorkspaceId],
  );
}
