import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useParams } from "react-router-dom";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { TabStrip, Text, Tooltip } from "@/components/ui";
import { Lock } from "@/components/ui/icons";
import { chatLabel } from "@/components/layout/sidebar/chat-item";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useGetRunByIdQuery, useGetRunsByWorkspaceQuery, type Run, type RunTurn, type Workspace } from "@/lib/redux/api";
import { setActiveTab, clearPendingRunId, activateWorkspaceView, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import { setRightPaneContextKey } from "@/lib/redux/slices/appSettingsSlice";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { useWorkspaceRouteTopRounding } from "@/hooks/use-workspace-route-top-rounding";
import { ReplicaViewContext } from "@/hooks/use-replica-view";
import { WorkspaceEvents } from "@/features/workspace/components/workspace-events";
import { BaseTab } from "@/features/workspace/components/base-tab";
import { TabIcon } from "@/features/workspace/components/run-tab";
import { TodoSummaryBar, parseStructuralPlanSnapshot } from "@/features/workspace/components/todo-summary-bar";
import { createRunCache } from "@/features/workspace/lib/run-cache";
import { useRunHistory } from "@/features/workspace/hooks/use-run-history";
import { useRunEventRefetch } from "@/features/workspace/hooks/use-run-event-refetch";
import { CONTENT_COLUMN_GUTTER } from "@/features/workspace/lib/content-column";
import { workspaceViewKey } from "@/features/workspace/lib/ui-context";
import { getProviderVariant, getProviderVariantById, type ProviderVariant } from "@/lib/provider-variants";
import { useBridgeRun } from "../hooks/use-bridge";
import { bridgeBackend } from "../lib/backends";
import { ReplicaComposerBar, isReplicaLive } from "./replica-composer-bar";
const EMPTY_RUNS: Run[] = [];
const EMPTY_TURNS: RunTurn[] = [];

const runVariant = (run: Pick<Run, "providerId">, fallback: ProviderVariant) => getProviderVariantById(run.providerId)?.variant ?? fallback;

/** Same tab strip as an owned chat: provider icon, live spinner and title. A lock replaces the chat menu. */
function ReplicaTabs({ runs, activeRunId, status, fallbackVariant, onSelect }: {
  runs: Run[]; activeRunId: string | undefined; status: BridgeStatus | undefined; fallbackVariant: ProviderVariant; onSelect(id: string): void;
}) {
  return <TabStrip activeKey={activeRunId} role="tablist" aria-label="Chat tabs"
    className="relative z-(--z-panel-toggle) hidden h-(--shell-header-height) min-w-0 items-end md:flex">
    {runs.map((row, index) => {
      const owner = bridgeBackend(status, row.ownerBackendId), title = chatLabel(row);
      return <BaseTab key={row.id} isFirst={index === 0} isActive={row.id === activeRunId} role="tab" ariaLabel={title} label={title}
        tooltip={`${title} · Read-only on ${owner.label}`} onClick={() => onSelect(row.id)}
        icon={<TabIcon run={row} variant={runVariant(row, fallbackVariant)} isActive={row.id === activeRunId} live={isReplicaLive(row, owner)} />}
        trailingAction={<Tooltip content={`Read-only · runs on ${owner.label}`} position="bottom">
          <Lock aria-label="Read-only" className="size-3.5 text-primary-500" />
        </Tooltip>} />;
    })}
  </TabStrip>;
}

/** Mirrors the owned chat page (header, painted panel, transcript column, composer slot)
 * without mounting composers, terminals, panels or provider controllers. */
export function ReplicaWorkspaceView({ initialRun, workspace, providerId, variant }: {
  initialRun?: Run | null; workspace: Workspace | null; providerId: string; variant: ProviderVariant;
}) {
  const dispatch = useAppDispatch();
  const backendId = useAppSelector((state) => state.backends.activeBackendId ?? "local");
  const activeTab = useAppSelector((state) => state.workspace.activeTab);
  const pendingRunId = useAppSelector((state) => state.workspace.pendingRunId);
  const { activeSpaceId } = useActiveSpace();
  const routeTopRounding = useWorkspaceRouteTopRounding();
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
  const runVariantName = run ? runVariant(run, variant) : variant;
  const tabs = useMemo(() => workspace && !routeRunId ? workspaceRuns : run ? [run] : EMPTY_RUNS, [workspace, routeRunId, workspaceRuns, run]);
  const selectTab = useCallback((id: string) => { dispatch(setActiveTab(id)); }, [dispatch]);
  const header = useMemo(() => tabs.length
    ? <ReplicaTabs runs={tabs} activeRunId={activeRunId} status={status} fallbackVariant={variant} onSelect={selectTab} />
    : null, [tabs, activeRunId, status, variant, selectTab]);
  useSetMainHeader(header, !!header && (tabs[0]?.id === activeRunId), loadingList);
  const visibleRun = run ? { ...run, goal: run.goal ?? "", title: run.title ?? undefined, lastError: run.lastError ?? undefined,
    startedAt: run.startedAt == null ? undefined : new Date(run.startedAt), endedAt: run.endedAt == null ? undefined : new Date(run.endedAt), createdAt: new Date(run.createdAt) } : null;
  const turns = (activeRunId && transcript.runTurns[activeRunId]) || EMPTY_TURNS;
  const structuralPlan = useMemo(() => parseStructuralPlanSnapshot(turns.find((turn) => turn.status === "active")?.metadata?.codexPlan), [turns]);
  const context = useMemo(() => ({ label: owner.label, online: owner.online, runId: activeRunId }), [owner.label, owner.online, activeRunId]);
  return <ReplicaViewContext.Provider value={context}>
    <div data-workspace-route="" data-testid="replica-run-view" className={`relative flex h-full flex-col ${routeTopRounding} overflow-hidden`}>
      <div className="relative flex min-h-0 flex-1 flex-col rounded-b-2xl bg-primary dark:bg-primary-950">
        <div className="content-inset min-h-0 flex-1 overflow-hidden noscrollbar">
          {visibleRun ? <WorkspaceEvents runs={[visibleRun]} activeTab={visibleRun.id} currentWorkspace={workspace}
            currentEvents={transcript.runEvents[visibleRun.id] ?? []} turns={turns}
            eventsEndRef={end as RefObject<HTMLDivElement>} issueTabs={[]} variant={getProviderVariant(runVariantName).variant}
            history={transcript.history} /> : <div className={`flex h-full flex-col items-center justify-center gap-1 text-center ${CONTENT_COLUMN_GUTTER}`}>
            <Text size="s" tone="muted">{loadingList ? "Loading conversations…" : `No conversations in ${workspace?.name ?? "this workspace"} on ${owner.label}`}</Text>
            {!loadingList && <Text size="xs" tone="muted">Chats started there appear here once they sync.</Text>}
          </div>}
        </div>
        {visibleRun && <div className="content-inset">
          <div className={CONTENT_COLUMN_GUTTER}>
            {isReplicaLive(visibleRun, owner) && <TodoSummaryBar events={transcript.runEvents[visibleRun.id] ?? []} structuralPlan={structuralPlan} variant={runVariantName} />}
            <ReplicaComposerBar run={run} owner={owner} status={status} hydration={hydration} variant={runVariantName} />
          </div>
        </div>}
      </div>
    </div>
  </ReplicaViewContext.Provider>;
}
