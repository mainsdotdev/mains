import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useParams } from "react-router-dom";
import { Button, Text } from "@/components/ui";
import { Lock } from "@/components/ui/icons";
import { chatLabel } from "@/components/layout/sidebar/chat-item";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useGetRunByIdQuery, useGetRunsByWorkspaceQuery, type Run, type Workspace } from "@/lib/redux/api";
import { setActiveTab, clearPendingRunId, activateWorkspaceView, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import { setRightPaneContextKey } from "@/lib/redux/slices/appSettingsSlice";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { ReplicaViewContext } from "@/hooks/use-replica-view";
import { WorkspaceEvents } from "@/features/workspace/components/workspace-events";
import { BaseTab } from "@/features/workspace/components/base-tab";
import { createRunCache } from "@/features/workspace/lib/run-cache";
import { useRunHistory } from "@/features/workspace/hooks/use-run-history";
import { useRunEventRefetch } from "@/features/workspace/hooks/use-run-event-refetch";
import { CONTENT_COLUMN_GUTTER } from "@/features/workspace/lib/content-column";
import { workspaceViewKey } from "@/features/workspace/lib/ui-context";
import type { ProviderVariant } from "@/lib/provider-variants";
import { getProviderVariant } from "@/lib/provider-variants";
import { useBridgeRun } from "../hooks/use-bridge";
import { bridgeBackend, bridgePresence } from "../lib/backends";
import { DeviceBadge } from "./device-badge";
const EMPTY_RUNS: Run[] = [];

/** Uses the existing paged transcript without mounting composers, terminals or provider controllers. */
export function ReplicaWorkspaceView({ initialRun, workspace, providerId, variant }: {
  initialRun?: Run | null; workspace: Workspace | null; providerId: string; variant: ProviderVariant;
}) {
  const dispatch = useAppDispatch();
  const backendId = useAppSelector((state) => state.backends.activeBackendId ?? "local");
  const activeTab = useAppSelector((state) => state.workspace.activeTab);
  const pendingRunId = useAppSelector((state) => state.workspace.pendingRunId);
  const { activeSpaceId } = useActiveSpace();
  const { runId: routeRunId } = useParams<{ runId?: string }>();
  const { currentData: workspaceRuns = EMPTY_RUNS, isLoading: loadingList } = useGetRunsByWorkspaceQuery(
    { workspaceId: workspace?.id ?? "", providerId, mode: "developer", limit: 100 }, { skip: !workspace },
  );
  const requested = routeRunId ?? (workspaceRuns.some((run) => run.id === pendingRunId) ? pendingRunId : null)
    ?? (workspaceRuns.some((run) => run.id === activeTab) ? activeTab : null) ?? initialRun?.id ?? workspaceRuns[0]?.id;
  const { currentData: freshRun } = useGetRunByIdQuery(requested ?? "", { skip: !requested });
  const run = freshRun ?? (initialRun?.id === requested ? initialRun : workspaceRuns.find((row) => row.id === requested));
  const activeRunId = run?.id;
  const { status, run: hydration } = useBridgeRun(activeRunId, true);
  const owner = bridgeBackend(status, run?.ownerBackendId ?? workspace?.ownerBackendId);
  const [cache] = useState(createRunCache);
  const transcript = useRunHistory(cache, activeRunId ?? null);
  const load = transcript.load;
  const end = useRef<HTMLDivElement>(null);
  const viewKey = workspaceViewKey({ backendId, spaceId: activeSpaceId, providerId, mode: run?.mode ?? "developer", workspaceId: workspace?.id, collectionId: run?.collectionId ?? null });
  useLayoutEffect(() => {
    dispatch(activateWorkspaceView({ key: viewKey, workspaceId: workspace?.id ?? null, providerId }));
  }, [dispatch, viewKey, workspace?.id, providerId]);
  useLayoutEffect(() => {
    if (!activeRunId) return;
    dispatch(setActiveTab(activeRunId));
    const ownerKey = runOwnerKey(backendId, activeRunId);
    dispatch(setComposerContextKey(ownerKey));
    dispatch(setRightPaneContextKey({ ownerKey, browserExpansionKey: ownerKey }));
    if (pendingRunId === activeRunId) dispatch(clearPendingRunId());
  }, [dispatch, activeRunId, pendingRunId, backendId]);
  useEffect(() => { if (activeRunId) void load(activeRunId); }, [load, activeRunId, hydration?.ready]);
  const refresh = useCallback(() => { if (activeRunId) void load(activeRunId); }, [load, activeRunId]);
  useRunEventRefetch(activeRunId, refresh, 250);
  const label = run ? chatLabel(run) : workspace?.name ?? "Synced conversation";
  const header = useMemo(() => <div className="flex h-(--shell-header-height) min-w-0 items-end overflow-x-auto noscrollbar">
    {(workspace && !routeRunId ? workspaceRuns : run ? [run] : []).map((row, index) => <BaseTab key={row.id} isFirst={index === 0}
      isActive={row.id === run?.id} role="tab" ariaLabel={chatLabel(row)} label={chatLabel(row)} tooltip={chatLabel(row)}
      icon={<Lock className="size-3.5" />} onClick={() => dispatch(setActiveTab(row.id))} />)}
  </div>, [workspace, workspaceRuns, run, routeRunId, dispatch]);
  useSetMainHeader(header, true, loadingList);
  const visibleRun = run ? { ...run, goal: run.goal ?? "", title: run.title ?? undefined, lastError: run.lastError ?? undefined,
    startedAt: run.startedAt == null ? undefined : new Date(run.startedAt), endedAt: run.endedAt == null ? undefined : new Date(run.endedAt), createdAt: new Date(run.createdAt) } : null;
  const context = useMemo(() => ({ label: owner.label, online: owner.online }), [owner.label, owner.online]);
  return <ReplicaViewContext.Provider value={context}>
    <div className="flex h-full min-h-0 flex-col" data-testid="replica-run-view">
      <div className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-primary-200/60 py-3 dark:border-primary-800/60 ${CONTENT_COLUMN_GUTTER}`}>
        <div className="flex min-w-0 items-center gap-2">
          <DeviceBadge backend={owner} />
          <Text size="xs" tone="muted">Read-only · {bridgePresence(owner)}</Text>
        </div>
        {status?.enabled && status.state !== "connected" && <Text size="xs" tone="muted">Showing saved data</Text>}
      </div>
      {hydration?.error && !hydration.ready && <div className={CONTENT_COLUMN_GUTTER}><Text size="xs" tone="muted">Waiting to download this conversation. Saved messages remain available.</Text></div>}
      {visibleRun ? <WorkspaceEvents runs={[visibleRun]} activeTab={visibleRun.id} currentWorkspace={workspace}
        currentEvents={transcript.runEvents[visibleRun.id] ?? []} turns={transcript.runTurns[visibleRun.id] ?? []}
        eventsEndRef={end as RefObject<HTMLDivElement>} issueTabs={[]} variant={getProviderVariant(variant).variant}
        history={transcript.history} /> : <div className="flex flex-1 items-center justify-center gap-2">
        <Text size="s" tone="muted">{loadingList ? "Loading conversations…" : "No conversations synced yet"}</Text>
        {!loadingList && <Button variant="secondary" onClick={refresh}>Refresh</Button>}
      </div>}
      <div className={`flex shrink-0 items-center justify-center gap-2 py-4 ${CONTENT_COLUMN_GUTTER}`}>
        <Lock aria-hidden="true" className="size-3.5 text-primary-500" />
        <Text size="xs" tone="muted">Connect to {owner.label} in Relay to control this conversation.</Text>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  </ReplicaViewContext.Provider>;
}
