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

  const { data: workspaces = [] } = useListWorkspacesQuery();

  const { data: allProviders = EMPTY_PROVIDERS } =
    useGetProvidersByKindQuery("agent_runtime");

  const providers = useMemo(
    () => allProviders.filter((p) => p.isEnabled),
    [allProviders],
  );

  // Resolve effective workspace ID: URL param > saved per-provider > first workspace
  const effectiveWorkspaceId = useMemo(() => {
    if (mode && mode !== "developer") return undefined;
    if (workspaceId) return workspaceId;
    if (providerId) {
      const saved = savedWorkspaceIdByProvider[providerId];
      if (saved && workspaces.some((w) => w.id === saved)) return saved;
    }
    return workspaces.length > 0 ? workspaces[0].id : undefined;
  }, [mode, workspaceId, providerId, savedWorkspaceIdByProvider, workspaces]);

  const { data: fetchedWorkspace } = useGetWorkspaceQuery(effectiveWorkspaceId!, {
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
    workspaceId: effectiveWorkspaceId,
    workspaces,
    providers,
    selectedWorkspace,
    selectedProvider,
    currentWorkspace,
    setSelectedProvider,
  };
}
