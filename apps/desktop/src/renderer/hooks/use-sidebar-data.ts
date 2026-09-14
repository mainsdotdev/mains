import { useEffect, useMemo } from "react";
import {
  useGetConnectionStatesQuery,
  useGetAccountQuery,
  useListWorkspacesQuery,
  useListWorkspaceGitStatesQuery,
  gitFlowApi,
  workspaceApi,
} from "@/lib/redux/api";
import { useAppDispatch } from "@/lib/redux/hooks";
import { appEvents } from "@/lib/transport";

interface UseSidebarDataOptions {
  searchQuery: string;
}

export function useSidebarData({ searchQuery }: UseSidebarDataOptions) {
  const dispatch = useAppDispatch();
  // Data queries
  const { data: account } = useGetAccountQuery();
  const { data: connections = [], refetch: refetchConnections } = useGetConnectionStatesQuery();

  const { data: workspaces = [], isLoading: isLoadingWorkspaces } =
    useListWorkspacesQuery();
  const { data: gitStates = [] } = useListWorkspaceGitStatesQuery();

  useEffect(
    () =>
      appEvents.workspace.onGitStateChanged((state) => {
        dispatch(
          workspaceApi.util.updateQueryData(
            "listWorkspaceGitStates",
            undefined,
            (draft) => {
              const current = draft.find(
                (item) => item.workspaceId === state.workspaceId,
              );
              if (current) {
                current.branch = state.branch;
                current.pathExists = state.pathExists;
              } else {
                draft.push(state);
              }
            },
          ),
        );
        dispatch(
          gitFlowApi.util.updateQueryData(
            "getGitFlowStatus",
            state.workspaceId,
            (draft) => {
              if (!draft) return;
              draft.branch = state.branch ?? "";
              draft.isDefaultBranch = draft.baseBranch
                ? draft.baseBranch === state.branch
                : state.branch === "main" || state.branch === "master";
            },
          ),
        );
      }),
    [dispatch],
  );

  const gitStateByWorkspaceId = useMemo(
    () =>
      new Map(
        gitStates.map((state) => [state.workspaceId, state] as const),
      ),
    [gitStates],
  );

  const connectedConnections = useMemo(() => {
    return connections.filter((connection) => connection.isConnected).map((connection) => connection.id);
  }, [connections]);

  // Filtered workspaces
  const filteredWorkspaces = useMemo(() => {
    if (!workspaces || !searchQuery.trim()) return workspaces || [];
    const lowerQuery = searchQuery.toLowerCase().trim();
    return workspaces.filter((ws) => {
      return (
        ws.name.toLowerCase().includes(lowerQuery) ||
        ws.rootPath.toLowerCase().includes(lowerQuery) ||
        gitStateByWorkspaceId
          .get(ws.id)
          ?.branch?.toLowerCase()
          .includes(lowerQuery)
      );
    });
  }, [workspaces, searchQuery, gitStateByWorkspaceId]);

  const handleRefreshConnections = async () => {
    await refetchConnections();
  };

  return {
    account,
    workspaces: filteredWorkspaces,
    gitStateByWorkspaceId,
    connections,
    connectedConnections,
    isLoadingWorkspaces,
    handleRefreshConnections,
  };
}
