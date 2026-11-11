/**
 * Keeping runs and workspace diffs in step with the main process: the push
 * subscriptions, polling fallback, and once-per-run finalization.
 *
 * Each subscription follows the scope of the state it refreshes:
 *  - transcript pushes are scoped to the *selected tab* (debounced,
 *    since a burst of events shouldn't mean a fetch each);
 *  - workspace diff pushes apply regardless of the selected tab or run status,
 *    since a completed turn's undo and a background run also change the tree;
 *  - status pushes are scoped to *any* open pending run, so a backgrounded tab
 *    cannot miss its terminal event;
 *  - the 10s poll is the fallback for a dropped push, a stalled adapter, or a
 *    backgrounded renderer, and stops as soon as the run is no longer running.
 *
 * Read receipts and execution-scoped terminal claims live in
 * conversation-lifecycle.ts. Only a current observation may finalize a run.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { appApi, appEvents, getTransport, onTransportChange } from "@/lib/transport";
import { captureConversationOwner, createConversationReadLifecycle, getConversationTransportEpoch } from "@/lib/conversation-lifecycle";
import { toast } from "@/components/ui";
import { useAppDispatch } from "@/lib/redux/hooks";
import { runsApi, workspaceApi } from "@/lib/redux/api";
import { classifyRunErrorKind } from "../../../../shared/run-errors";
import type { Run } from "../types";
import type { RunCache } from "../lib/run-cache";
import { createRunStatusSyncPolicy } from "../lib/run-status-sync";

export interface RunSyncDeps {
  runs: Run[];
  scopeKey?: string | null;
  activeRunId: string | null;
  /** The run hook's bookkeeping instance — read for the finalized set. */
  cache: RunCache;
  /** Refresh one run's transcript. */
  loadRunDetails: (runId: string) => Promise<void>;
  /** Replace one run in the list with a newer copy of it. */
  onRunUpdated: (run: Run) => void;
  /** Settle assistant previews, clear transient status, and leave voice alone. */
  clearTurnStreams: (interrupted?: boolean) => void;
}

export function useRunSync({
  runs,
  scopeKey,
  activeRunId,
  cache,
  loadRunDetails,
  onRunUpdated,
  clearTurnStreams,
}: RunSyncDeps) {
  const dispatch = useAppDispatch();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const [reads] = useState(createConversationReadLifecycle);
  const epoch = useSyncExternalStore(onTransportChange, getConversationTransportEpoch, getConversationTransportEpoch);
  const scope = JSON.stringify([scopeKey ?? null, epoch]);
  useLayoutEffect(() => {
    reads.bind(scope);
    return () => reads.release();
  }, [reads, scope]);
  const scopeCurrent = useCallback(() => reads.bound(scope) && getConversationTransportEpoch() === epoch, [reads, scope, epoch]);
  const beginRunRead = useCallback((id: string, skipPending = false) => reads.begin(id, getTransport(), { valid: scopeCurrent, skipPending }), [reads, scopeCurrent]);
  const clearStreams = useRef(clearTurnStreams);
  useLayoutEffect(() => { clearStreams.current = clearTurnStreams; }, [clearTurnStreams]);

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

  const finalizeRun = useCallback(async (run: Run, receipt?: () => boolean) => {
    const owner = receipt ? null : beginRunRead(run.id);
    const current = receipt ?? owner?.current;
    if (!current) return;
    let effectOwner: ReturnType<typeof captureConversationOwner> | undefined;
    try {
      if (!current()) return;
      if (run.status === "running" || run.status === "queued") {
        cache.markRunning(run.id);
        return;
      }
      const terminal = cache.claimFinalization(run.id);
      if (!terminal) return;
      // Duplicate terminal reads may supersede this read while diagnosis is
      // pending. The effect belongs to the execution and scope, not that read.
      const effect = captureConversationOwner(getTransport(), scopeCurrent);
      effectOwner = effect;
      const accepted = () => effect.current() && terminal.current();
      if (run.status === "failed") {
        const lastError = run.lastError || "Run failed";
        let isAuthError = classifyRunErrorKind(lastError) === "auth";
        if (!isAuthError && /exited with code/i.test(lastError)) {
          try {
            const result = await appApi.runs.getHistory({ runId: run.id, direction: "latest" });
            if (!accepted()) return;
            if (result.success && result.data) {
              isAuthError = result.data.artifacts.some((artifact) => classifyRunErrorKind(artifact.content) === "auth");
            }
          } catch { /* Diagnosis is optional; preserve the actual failure notification. */ }
        }
        const message = isAuthError ? "Authentication expired — sign in from the session view" : lastError;
        if (accepted()) toast.error(message, { duration: isAuthError ? 8000 : 5000 });
      } else if (run.status === "canceled" && accepted()) toast.error("Run canceled");
      if (!accepted()) return;
      dispatch(runsApi.util.invalidateTags(["Runs", "WorkspaceDiffs"]));
      dispatch(workspaceApi.util.invalidateTags(["Workspaces", "Reviews", "ReviewFindings"]));
    } finally {
      effectOwner?.release();
      owner?.release();
    }
  }, [cache, dispatch, beginRunRead, scopeCurrent]);

  // Voice transcripts can persist between work turns, while the run is idle.
  // Subscribe for the selected tab throughout the conversation.
  // Debounce transcript refetches to coalesce event bursts.
  useEffect(() => {
    if (!activeRunId || !scopeCurrent()) return;

    let refetchTimer: number | null = null;
    const scheduleRefetch = () => {
      if (!scopeCurrent() || refetchTimer !== null) return;
      refetchTimer = window.setTimeout(() => {
        refetchTimer = null;
        if (scopeCurrent()) void loadRunDetails(activeRunId);
      }, 250);
    };

    const offEvent = appEvents.runs.onEventPersisted(({ runId }) => {
      if (runId === activeRunId) scheduleRefetch();
    });
    // Subscribe before the catch-up read so an event persisted while the tab
    // was being registered cannot leave it waiting for the polling fallback.
    void loadRunDetails(activeRunId);

    return () => {
      offEvent();
      if (refetchTimer !== null) window.clearTimeout(refetchTimer);
    };
  }, [activeRunId, loadRunDetails, scopeCurrent]);

  // The backend recomputes and broadcasts the workspace diff after undo too.
  // Keep this listener alive when the selected run is finished, and refresh
  // the affected workspace even if another run or the editor is selected.
  useEffect(() => appEvents.runs.onDiffUpdated(({ workspaceId }) => {
    if (!scopeCurrent()) return;
    dispatch(
      workspaceApi.util.invalidateTags([
        { type: "WorkspaceDiffs", id: workspaceId },
      ]),
    );
  }), [dispatch, scopeCurrent]);

  // Run status is workspace-scoped, not tab-scoped. Keep listening while any
  // run is open, so an inactive tab cannot miss its terminal event and a
  // settled run continued from elsewhere comes back to life here.
  useEffect(() => {
    if (!statusSyncPolicy.listen) return;

    return appEvents.runs.onStatusChanged(async ({ runId, status }) => {
      const targetRunId = statusSyncPolicy.targetRunId(runId, status);
      if (!targetRunId) return;
      const request = beginRunRead(targetRunId);
      if (!request) return;
      if (status === "running" || status === "queued") cache.markRunning(targetRunId);
      try {
        const result = await appApi.runs.getById(targetRunId);
        if (!request.current() || !result.success || !result.data) return;
        onRunUpdated(result.data);
        await finalizeRun(result.data, request.current);
        if (request.current()) void loadRunDetails(targetRunId);
      } catch (error) { if (request.current()) console.error("Run status refresh failed:", error); }
      finally { request.release(); }
    });
  }, [statusSyncPolicy, cache, loadRunDetails, finalizeRun, onRunUpdated, beginRunRead]);

  // Polling fallback for dropped pushes, stalled adapters, or backgrounded
  // renderers. 10s keeps IO low since push handles the common case.
  useEffect(() => {
    if (activeRunStatus !== "running") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (activeRunStatus === "succeeded" || activeRunStatus === "canceled" || activeRunStatus === "failed") {
        clearStreams.current(activeRunStatus !== "succeeded");
      }
      return;
    }

    const timer = setInterval(async () => {
      if (!activeRunId) return;
      const request = beginRunRead(activeRunId, true);
      if (!request) return;
      try {
        void loadRunDetails(activeRunId);
        const result = await appApi.runs.getById(activeRunId);
        if (!request.current() || !result.success || !result.data) return;
        onRunUpdated(result.data);
        if (result.data.status !== "running") {
          if (pollingRef.current === timer) { clearInterval(timer); pollingRef.current = null; }
          await finalizeRun(result.data, request.current);
        }
      } catch (error) { if (request.current()) console.error("Polling error:", error); }
      finally { request.release(); }
    }, 10000);
    pollingRef.current = timer;
    return () => { clearInterval(timer); if (pollingRef.current === timer) pollingRef.current = null; };
  }, [activeRunId, activeRunStatus, loadRunDetails, finalizeRun, onRunUpdated, beginRunRead]);

  return { finalizeRun, beginRunRead };
}
