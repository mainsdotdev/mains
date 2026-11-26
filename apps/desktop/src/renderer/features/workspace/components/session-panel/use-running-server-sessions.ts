import { useMemo } from "react";
import { createSelector, lruMemoize } from "@reduxjs/toolkit";
import { shallowEqual } from "react-redux";
import type { TerminalSession } from "@mains/contracts/terminal";
import { useGetTerminalSessionsQuery } from "@/lib/redux/api";

const selectRunningServers = createSelector(
  [({ currentData }: { currentData?: TerminalSession[] }) => currentData],
  (terminals) => (terminals ?? []).filter(
    (session) => session.workspaceId && session.status === "running" && (session.servers?.length ?? 0) > 0,
  ),
  { memoize: lruMemoize, memoizeOptions: { resultEqualityCheck: shallowEqual } },
);

export function useRunningServerSessions(enabled: boolean, activeWorkspaceId: string | null) {
  const { servers } = useGetTerminalSessionsQuery(undefined, {
    skip: !enabled,
    selectFromResult: (result) => ({ servers: selectRunningServers(result) }),
  });

  return useMemo(
    () => [...servers].sort((a, b) => Number(b.workspaceId === activeWorkspaceId) - Number(a.workspaceId === activeWorkspaceId)),
    [servers, activeWorkspaceId],
  );
}
