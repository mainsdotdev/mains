/**
 * Keeping a live run in step with the main process: the two push subscriptions,
 * the polling fallback behind them, and the once-per-run finalization they all
 * funnel into.
 *
 * Three listeners with three different scopes, which is the reason they read as
 * one subject rather than three effects scattered through the run hook:
 *  - transcript pushes are scoped to the *selected running tab* (debounced,
 *    since a burst of events shouldn't mean a fetch each);
 *  - status pushes are scoped to *any* open pending run, so a backgrounded tab
 *    cannot miss its terminal event;
 *  - the 10s poll is the fallback for a dropped push, a stalled adapter, or a
 *    backgrounded renderer, and stops as soon as the run is no longer running.
 *
 * `finalizeRun` is idempotent through the run cache's finalized set — all three
 * paths can reach the same terminal status, and only the first one reports it.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { appApi, appEvents } from "@/lib/transport";
import { toast } from "@/components/ui";
import { useAppDispatch } from "@/lib/redux/hooks";
import { runsApi, workspaceApi } from "@/lib/redux/api";
import { classifyRunErrorKind } from "../../../../shared/run-errors";
import { getProviderVariantById } from "@/lib/provider-variants";
import type { Run } from "../types";
import type { RunCache } from "../lib/run-cache";
import { createRunStatusSyncPolicy } from "../lib/run-status-sync";

export interface RunSyncDeps {
  runs: Run[];
  activeRunId: string | null;
  /** The run hook's bookkeeping instance — read for the finalized set. */
  cache: RunCache;
  /** Refresh one run's transcript. */
  loadRunDetails: (runId: string) => Promise<void>;
  /** Replace one run in the list with a newer copy of it. */
  onRunUpdated: (run: Run) => void;
  /** Drop in-flight streaming buffers once nothing is running. */
  clearAllStreams: () => void;
}

export function useRunSync({
  runs,
  activeRunId,
  cache,
  loadRunDetails,
  onRunUpdated,
  clearAllStreams,
}: RunSyncDeps) {
  const dispatch = useAppDispatch();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Derive the active run's status so the effects below only rebind on actual
  // status flips, not on every `runs` refetch.
  const activeRunStatus = useMemo(
    () => runs.find((r) => r.id === activeRunId)?.status,
    [runs, activeRunId],
  );
  const statusSyncPolicy = useMemo(
    () => createRunStatusSyncPolicy(runs),
    [runs],
  );

  const finalizeRun = useCallback(async (run: Run) => {
    if (run.status === "running" || run.status === "queued") return;
    if (cache.isFinalized(run.id)) return;
    cache.markFinalized(run.id);

    if (run.status === "failed") {
      const lastError = run.lastError || "Run failed";
      let isAuthError = classifyRunErrorKind(lastError) === "auth";
      if (!isAuthError && /exited with code/i.test(lastError)) {
        const artRes = await appApi.runArtifacts.getByRun(run.id);
        if (artRes.success && artRes.data) {
          isAuthError = artRes.data.some(
            (a: { content: any }) => classifyRunErrorKind(a.content) === "auth",
          );
        }
      }
      if (isAuthError) {
        // The transcript renders a Sign in notice for this run — the toast
        // just names the fix for anyone who dismisses it.
        const loginCommand = getProviderVariantById(run.providerId)?.authLoginCommand;
        toast.error(
          loginCommand
            ? `Authentication expired — sign in from the session view or run \`${loginCommand}\``
            : "Authentication expired — sign in from the session view",
          { duration: 8000 },
        );
      } else {
        toast.error(lastError, { duration: 5000 });
      }
    } else if (run.status === "canceled") {
      toast.error("Run canceled");
    }

    dispatch(runsApi.util.invalidateTags(["Runs", "WorkspaceDiffs"]));
    dispatch(workspaceApi.util.invalidateTags(["Workspaces"]));
    dispatch(workspaceApi.util.invalidateTags(["Reviews"]));
    dispatch(workspaceApi.util.invalidateTags(["ReviewFindings"]));
  }, [cache, dispatch]);

  // Transcript and live-diff pushes are scoped to the selected running tab.
  // Debounce transcript refetches to coalesce event bursts.
  useEffect(() => {
    if (!activeRunId || activeRunStatus !== "running") return;

    let refetchTimer: number | null = null;
    const scheduleRefetch = () => {
      if (refetchTimer !== null) return;
      refetchTimer = window.setTimeout(() => {
        refetchTimer = null;
        loadRunDetails(activeRunId);
      }, 250);
    };

    const offEvent = appEvents.runs.onEventPersisted(({ runId }) => {
      if (runId === activeRunId) scheduleRefetch();
    });

    // Live workspace diff: invalidate cached diff queries on each
    // incremental recomputation so the UI re-renders with fresh changes.
    const offDiff = appEvents.runs.onDiffUpdated(({ runId, workspaceId }) => {
      if (runId !== activeRunId) return;
      dispatch(
        workspaceApi.util.invalidateTags([
          { type: "WorkspaceDiffs", id: workspaceId },
        ]),
      );
    });

    return () => {
      offEvent();
      offDiff();
      if (refetchTimer !== null) window.clearTimeout(refetchTimer);
    };
  }, [activeRunId, activeRunStatus, loadRunDetails, dispatch]);

  // Run status is workspace-scoped, not tab-scoped. Keep listening while any
  // open run is pending so an inactive tab cannot miss its terminal event.
  useEffect(() => {
    if (!statusSyncPolicy.listen) return;

    return appEvents.runs.onStatusChanged(async ({ runId }) => {
      const targetRunId = statusSyncPolicy.targetRunId(runId);
      if (!targetRunId) return;

      const result = await appApi.runs.getById(targetRunId);
      if (result.success && result.data) {
        onRunUpdated(result.data);
        await finalizeRun(result.data);
      }

      // Pull the final transcript while the completion event is fresh. This
      // makes the completed tab ready even before the user switches back.
      void loadRunDetails(targetRunId);
    });
  }, [statusSyncPolicy, loadRunDetails, finalizeRun, onRunUpdated]);

  // Polling fallback for dropped pushes, stalled adapters, or backgrounded
  // renderers. 10s keeps IO low since push handles the common case.
  useEffect(() => {
    if (activeRunStatus !== "running") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      clearAllStreams();
      return;
    }

    pollingRef.current = setInterval(async () => {
      try {
        if (!activeRunId) return;
        loadRunDetails(activeRunId);

        const result = await appApi.runs.getById(activeRunId);
        if (!result.success || !result.data) return;

        onRunUpdated(result.data);

        if (result.data.status !== "running") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          await finalizeRun(result.data);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 10000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, activeRunStatus, loadRunDetails, finalizeRun, onRunUpdated]);

  return { finalizeRun };
}
