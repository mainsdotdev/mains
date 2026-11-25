import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAppSelector } from "@/lib/redux/hooks";
import {
  useListWorkspacesQuery,
  useGetWorkspaceQuery,
} from "@/lib/redux/api/workspaceApi";
import { useGetProvidersByKindQuery } from "@/lib/redux/api/providersApi";
import type { ModeId } from "../../../../shared/modes";

const EMPTY_PROVIDERS: never[] = [];

export function useWorkspaceData(providerId?: string, mode?: ModeId) {
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  const savedWorkspaceIdByProvider = useAppSelector(
    (state) => state.workspace.activeWorkspaceIdByProvider,
  );

  const [userSelectedProvider, setSelectedProvider] =
    useState<string | null>(null);

  const { data: workspaces = [], isLoading: loadingWorkspaces } = useListWorkspacesQuery();

  const { data: allProviders = EMPTY_PROVIDERS } =
    useGetProvidersByKindQuery("agent_runtime");

  const providers = useMemo(
    () => allProviders.filter((p) => p.isEnabled),
    [allProviders],
  );

  // Replicas require an explicit workspace URL. The home route restores an owned workspace.
  const effectiveWorkspaceId = useMemo(() => {
    if (mode && mode !== "developer") return undefined;
    if (workspaceId) return workspaceId;
    if (providerId) {
      const saved = savedWorkspaceIdByProvider[providerId];
      if (saved && workspaces.some((w) => w.id === saved && !w.isReplica)) return saved;
    }
    return workspaces.find((workspace) => !workspace.isReplica)?.id;
  }, [mode, workspaceId, providerId, savedWorkspaceIdByProvider, workspaces]);

  const { currentData: fetchedWorkspace, isLoading: loadingWorkspace, isFetching: fetchingWorkspace } = useGetWorkspaceQuery(effectiveWorkspaceId!, {
    skip: !effectiveWorkspaceId,
  });

  const currentWorkspace = useMemo(() => {
    if (effectiveWorkspaceId) {
      return (
        workspaces.find((w) => w.id === effectiveWorkspaceId) ?? fetchedWorkspace ?? null
      );
    }
    return null;
  }, [effectiveWorkspaceId, workspaces, fetchedWorkspace]);

  const selectedProvider = useMemo(() => {
    if (userSelectedProvider) return userSelectedProvider;
    if (providers.length > 0) return providers[0].id;
    return "claude-code";
  }, [userSelectedProvider, providers]);

  const selectedWorkspace = useMemo(() => {
    return effectiveWorkspaceId ?? "";
  }, [effectiveWorkspaceId]);

  return {
    loading: loadingWorkspaces || (!!effectiveWorkspaceId && !currentWorkspace && (loadingWorkspace || fetchingWorkspace)),
    workspaceId: effectiveWorkspaceId,
    workspaces,
    providers,
    selectedWorkspace,
    selectedProvider,
    currentWorkspace,
    setSelectedProvider,
  };
}
