/**
 * The sidebar dock's read/act path: which live runs are off-screen, and the two
 * things the user can do with one — jump back into it, or stop it.
 *
 * The run list is main-process truth (`runs:listActive` cross-checks the session
 * registry), pushed on `runs:statusChanged` — which now fires when a session
 * *starts*, not only when it ends, so a run launched from another window, a
 * remote client, or an automation shows up here without a poll. The slow poll
 * behind it exists for the title, which is generated a beat after the run
 * starts, and as the fallback for a dropped push.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { appEvents } from "@/lib/transport";
import { toast } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  useAbortRunMutation,
  useListActiveRunsQuery,
  useSetActiveSpaceMutation,
  useUpdateSpaceMutation,
  type ActiveRun,
} from "@/lib/redux/api";
import {
  setPendingRunId,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { useActiveSpace } from "@/hooks/use-active-space";
import { getRouteRunId, getRouteType, WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import {
  mergeLingeringRuns,
  resolveRunSpaceTarget,
  selectBackgroundRuns,
} from "../lib/background-runs";
import { isRunTab } from "../lib/repo-utils";
import { useBackgroundRunActivity } from "./use-background-run-activity";

/** Fallback refresh: picks up generated titles and any missed status push. */
const REFRESH_INTERVAL_MS = 10_000;
/**
 * How long a finished run stays on the dock. Its last moment is the one worth
 * seeing — it succeeded, it failed, it was stopped — and a card that vanishes
 * on the status flip takes that with it.
 */
const FINISHED_LINGER_MS = 10_000;

export interface BackgroundRunsView {
  runs: ActiveRun[];
  /** Latest streamed line per run id, for the card's activity subtitle. */
  activityByRunId: Record<string, string>;
  jumpToRun: (run: ActiveRun) => Promise<void>;
  stopRun: (run: ActiveRun) => Promise<void>;
  stoppingRunIds: string[];
}

export function useBackgroundRuns(): BackgroundRunsView {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { activeSpaceId, activeSpace, spaces } = useActiveSpace();
  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [updateSpace] = useUpdateSpaceMutation();
  const [abortRun] = useAbortRunMutation();
  const [requestedStops, setRequestedStops] = useState<string[]>([]);

  const { data: activeRuns = [], refetch } = useListActiveRunsQuery(undefined, {
    pollingInterval: REFRESH_INTERVAL_MS,
  });

  // Runs that just finished, held for FINISHED_LINGER_MS. The status push is
  // the only place their outcome is known at the moment it happens — one beat
  // later the backend has dropped them from the active list, and refetching
  // them individually to learn how they ended would be a race against the card
  // the user is looking at.
  const [lingeringRuns, setLingeringRuns] = useState<ActiveRun[]>([]);
  // The status listener needs the newest list without rebinding on every
  // refetch — a rebind between the event and the snapshot would lose the run.
  const activeRunsRef = useRef(activeRuns);
  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);
  const lingerTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = lingerTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(
    () =>
      appEvents.runs.onStatusChanged(({ runId, status }) => {
        void refetch();
        if (status === "running" || status === "queued") return;

        const finished = activeRunsRef.current.find((run) => run.id === runId);
        if (!finished) return;

        setLingeringRuns((prev) => [
          ...prev.filter((run) => run.id !== runId),
          { ...finished, status: status as ActiveRun["status"], endedAt: Date.now() },
        ]);

        window.clearTimeout(lingerTimersRef.current.get(runId));
        lingerTimersRef.current.set(
          runId,
          window.setTimeout(() => {
            lingerTimersRef.current.delete(runId);
            setLingeringRuns((prev) => prev.filter((run) => run.id !== runId));
          }, FINISHED_LINGER_MS),
        );
      }),
    [refetch],
  );

  // Not the route param: `/code` with no param still renders a workspace (the
  // one saved per provider), and that workspace is just as much on screen as a
  // named one. The page publishes whichever it resolved as `activeWorkspaceId`,
  // so read that — but only while the code route is the one showing, since the
  // value is persisted and outlives the page.
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const activeTab = useAppSelector((state) => state.workspace.activeTab);
  const isCodeRoute = getRouteType(location.pathname) === "code";
  const visibleWorkspaceId = isCodeRoute ? activeWorkspaceId : null;

  // Same story for the workspace-less run the chat modes render, with one extra
  // reason the route param can't answer it: this hook runs in the sidebar,
  // outside the `<Routes>` tree, so `useParams` here has no match to read at
  // all. The URL is still consulted first — a sidebar jump names the run a beat
  // before the page adopts it — and `activeTab` covers the case the URL never
  // names, a run started on `/code` with no param.
  const visibleRunId = isCodeRoute
    ? getRouteRunId(location.pathname) ??
      (isRunTab(activeTab) ? activeTab : null)
    : null;

  const runs = useMemo(
    () =>
      selectBackgroundRuns({
        activeRuns: mergeLingeringRuns(activeRuns, lingeringRuns),
        visibleWorkspaceId,
        visibleProviderId: activeSpace?.providerId ?? null,
        visibleMode: activeSpace?.mode ?? null,
        visibleRunId,
      }),
    [activeRuns, lingeringRuns, activeSpace, visibleWorkspaceId, visibleRunId],
  );

  const runIds = useMemo(() => runs.map((run) => run.id), [runs]);
  const activityByRunId = useBackgroundRunActivity(runIds);

  const jumpToRun = useCallback(
    async (run: ActiveRun) => {
      // The page shows one provider and one mode at a time, so landing on the
      // workspace is only half the jump — without the right space, the run is
      // filtered out of the tab list and the page falls back to the newest one
      // it can show.
      const target = resolveRunSpaceTarget(run, spaces, activeSpaceId || null);
      if (!target) {
        toast.error("No space is set up for this run's agent");
        return;
      }

      dispatch(setPendingRunId(run.id));
      dispatch(setSelectedCollectionId(run.collectionId));

      const needsSpaceSwitch = target.spaceId !== activeSpaceId;
      if (needsSpaceSwitch || target.modeSwitch) {
        try {
          // Same ordering as the space picker: leave `/code/:workspaceId`
          // before switching, so the incoming space's provider never renders
          // against the outgoing space's workspace param.
          navigate("/", { replace: true });
          // The dock is the one surface that spans modes, so it is also the one
          // that has to put a space back into the mode its run was started in.
          if (target.modeSwitch) {
            await updateSpace({
              id: target.spaceId,
              payload: { mode: target.modeSwitch },
            }).unwrap();
          }
          if (needsSpaceSwitch) await setActiveSpace(target.spaceId).unwrap();
        } catch (error) {
          console.error("Failed to switch space for background run:", error);
          toast.error("Failed to switch space");
          return;
        }
      }

      navigate(
        run.mode === "developer" && run.workspaceId
          ? `${WORKSPACE_BASE_PATH}/${run.workspaceId}`
          : `${WORKSPACE_BASE_PATH}/runs/${run.id}`,
      );
    },
    [activeSpaceId, spaces, dispatch, navigate, setActiveSpace, updateSpace],
  );

  const stopRun = useCallback(
    async (run: ActiveRun) => {
      setRequestedStops((prev) =>
        prev.includes(run.id) ? prev : [...prev, run.id],
      );
      try {
        await abortRun(run.id).unwrap();
        // The card leaves on the session's own terminal status event, so the
        // spinner keeps running until the adapter has actually stopped.
      } catch (error) {
        console.error("Failed to stop background run:", error);
        toast.error("Failed to stop run");
        setRequestedStops((prev) => prev.filter((id) => id !== run.id));
      }
    },
    [abortRun],
  );

  // A stop request only means anything while the run is still listed — derive
  // it rather than resetting state when a run leaves the dock.
  const stoppingRunIds = useMemo(
    () => requestedStops.filter((id) => runIds.includes(id)),
    [requestedStops, runIds],
  );

  return { runs, activityByRunId, jumpToRun, stopRun, stoppingRunIds };
}
