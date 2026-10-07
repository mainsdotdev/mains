/**
 * The workspace's run list and everything read off it: which run is selected,
 * each run's transcript, and how both get loaded.
 *
 * Two subjects are delegated rather than inlined here, because neither is about
 * *holding* run state:
 *  - `use-run-operations.ts` — starting, continuing, forking, reviewing;
 *  - `use-run-sync.ts` — the push subscriptions, the polling fallback, and
 *    finalization for a live run.
 *
 * Both reach back through the same three seams (`registerNewRun`,
 * `loadRunDetails`, `onRunUpdated`), which is the whole contract between them
 * and this hook. Bookkeeping that isn't React state at all — the retained-run
 * LRU, loaded flags, in-flight dedup — lives in `lib/run-cache.ts`.
 */

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { appApi, appEvents } from "@/lib/transport";
import type { Run, RunEvent } from "../types";
import type { ModeId } from "../../../../shared/modes";
import { toast } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { runsApi, useArchiveRunMutation } from "@/lib/redux/api";
import { clearPendingRunId, setActiveTab } from "@/lib/redux/slices/workspaceSlice";
import { createRunCache } from "../lib/run-cache";
import { useRunOperations } from "./use-run-operations";
import { useRunSync } from "./use-run-sync";
import { useStreamingEvents } from "./use-streaming-events";
import { useRunHistory } from "./use-run-history";

const NO_WORKSPACE_IDS: readonly string[] = [];

export function useWorkspaceRuns(
  workspaceId: string | undefined,
  providerId?: string,
  mode?: ModeId,
  routeRunId?: string,
  /** Workspaces the user can switch to next; their run lists are fetched ahead. */
  prefetchWorkspaceIds: readonly string[] = NO_WORKSPACE_IDS,
  /** Embedded app conversations own their selection without changing workspace tabs. */
  options: { selection?: "workspace" | "local" } = {},
) {
  const publishSelection = options.selection !== "local";
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cache] = useState(createRunCache);
  const { runEvents, runTurns, load: loadHistory, clear: clearHistory, forget: forgetHistory, history } = useRunHistory(cache, activeRunId);
  const persistedStreamIds = useMemo(() => new Set(
    (activeRunId ? runEvents[activeRunId] ?? [] : [])
      .map((event) => event.metadata?.streamId).filter((id): id is string => typeof id === "string"),
  ), [activeRunId, runEvents]);
  const { streamingEvents, clearTurnStreams } = useStreamingEvents(activeRunId, persistedStreamIds);
  const dispatch = useAppDispatch();
  const [archiveRun] = useArchiveRunMutation();

  const eventsEndRef = useRef<HTMLDivElement>(null);
  // Which run a jump asked for, held in a ref: the mount effect depends on
  // `loadWorkspaceRuns`, so reading this from state would re-clear the page
  // every time the request is set or consumed.
  const pendingRunId = useAppSelector((s) => publishSelection ? s.workspace.pendingRunId : null);
  const pendingRunIdRef = useRef(pendingRunId);
  useEffect(() => {
    pendingRunIdRef.current = pendingRunId;
  }, [pendingRunId]);
  // Each workspace's last known run list, so switching back to one shows its
  // tabs in the same frame instead of an empty page while the list reloads.
  // Held like `cache`: never reassigned, and read during render.
  const [runLists] = useState(() => new Map<string, Run[]>());

  // Which list the page is showing: a routed run, a workspace, or nothing.
  // `loadedKey` names the view whose list is known, so an empty `runs` can be
  // told apart from one that simply hasn't arrived yet.
  const viewKey = routeRunId
    ? `run:${routeRunId}`
    : workspaceId
      ? `ws:${workspaceId}`
      : null;
  const [shownKey, setShownKey] = useState(viewKey);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (shownKey !== viewKey) {
    // Swap during render, not in an effect: an effect would first paint the
    // workspace being left under the new one's name.
    const remembered =
      workspaceId && !routeRunId ? runLists.get(workspaceId) : undefined;
    setShownKey(viewKey);
    setRuns(remembered ?? []);
    setActiveRunId(remembered?.[0]?.id ?? null);
    setLoadedKey(remembered ? viewKey : null);
  }
  const runsLoaded = viewKey === null || loadedKey === viewKey;

  // A run selected through the floating window may need to join this list.
  // Its asynchronous fetch must not insert into a view navigated to later.
  const selectionRevisionRef = useRef(0);
  useLayoutEffect(() => () => {
    selectionRevisionRef.current += 1;
  }, [viewKey, providerId, mode]);

  // --- Internal helpers ---

  const clearState = useCallback(() => {
    setRuns([]);
    setActiveRunId(null);
    clearHistory();
    cache.clear();
  }, [cache, clearHistory]);

  /** Swap in a newer copy of one run, leaving the rest of the list untouched. */
  const onRunUpdated = useCallback((run: Run) => {
    setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
  }, []);

  // --- Data loading ---

  const loadRunDetailsOnce = loadHistory;

  /** Public entry point: runs at most one `loadRunDetailsOnce` per run at a time,
   *  with a single trailing refresh if another request arrived while it ran. This
   *  keeps the selected window and its committed event base consistent — concurrent refreshes coalesce while paging is serialized
   *  by useRunHistory. */
  const loadRunDetails = useCallback(
    async (runId: string) => {
      // Admit one load per run; a request mid-load queues a single trailing reload.
      if (!cache.tryAcquireLoad(runId)) return;
      try {
        do {
          cache.clearPending(runId);
          await loadRunDetailsOnce(runId);
        } while (cache.hasPending(runId));
      } finally {
        cache.releaseLoad(runId);
      }
    },
    [loadRunDetailsOnce, cache],
  );

  /** Select a newly created run and catch up even if its first push already fired. */
  const registerNewRun = useCallback(async (runId: string): Promise<string | null> => {
    const runResult = await appApi.runs.getById(runId);
    if (runResult.success && runResult.data) {
      const newId = runResult.data.id;
      setRuns((prev) => [runResult.data, ...prev.filter((run) => run.id !== newId)]);
      setActiveRunId(newId);
      // Embedded conversations can start while the chat sidebar is unmounted.
      // Refresh its retained list without depending on a title/status push.
      dispatch(runsApi.util.invalidateTags(["Runs", "Workspaces"]));
      cache.touch(newId);
      void loadRunDetails(newId);
      return newId;
    }
    return null;
  }, [dispatch, cache, loadRunDetails]);

  const loadWorkspaceRuns = useCallback(
    async (wsId: string, isCurrent: () => boolean) => {
      // A remembered list already put a run on screen; the reload refreshes
      // the list around it rather than jumping to another one.
      const wasShown = runLists.has(wsId);
      const rememberedRunId = runLists.get(wsId)?.[0]?.id;
      let filteredRuns: Run[] = [];
      try {
        const result = await appApi.runs.getByWorkspace(wsId, {
          limit: 50,
          providerId,
          mode,
        });
        if (result.success && result.data) filteredRuns = result.data;
      } catch (err) {
        console.error("Failed to load workspace runs:", err);
      }
      // The user moved on while this was in flight.
      if (!isCurrent()) return;

      runLists.set(wsId, filteredRuns);
      setRuns(filteredRuns);
      setLoadedKey(`ws:${wsId}`);
      // A jump from outside the page (the background-runs dock, the chat
      // sidebar) names the run to open; every other arrival lands on the
      // newest one. Read through a ref so the request can't re-trigger
      // the mount effect.
      const requestedId = pendingRunIdRef.current;
      if (requestedId) dispatch(clearPendingRunId());
      const requested = filteredRuns.find((run: Run) => run.id === requestedId);
      const target = requested ?? (wasShown ? undefined : filteredRuns[0]);
      if (target) {
        setActiveRunId(target.id);
        loadRunDetails(target.id);
        // A requested run must own the view too — without this, the
        // editor-tab auto-select (developer) or the new-chat neutral
        // state (tab-less modes) claims it instead.
        if (target === requested) {
          dispatch(setActiveTab(target.id));
        }
      } else if (
        rememberedRunId &&
        filteredRuns.some((run) => run.id === rememberedRunId)
      ) {
        // Prefetch only caches the tab list. The render-time workspace swap
        // selects its first run, so load that transcript even when no new tab
        // selection is needed.
        loadRunDetails(rememberedRunId);
      }
    },
    [runLists, loadRunDetails, providerId, mode, dispatch],
  );

  const loadRoutedRun = useCallback(
    async (runId: string, isCurrent: () => boolean) => {
      try {
        const [result, accountResult] = await Promise.all([
          appApi.runs.getById(runId),
          appApi.account.get(),
        ]);
        if (!isCurrent()) return;
        setLoadedKey(`run:${runId}`);
        const run = result.success ? result.data : null;
        const accountId =
          accountResult.success && accountResult.data
            ? accountResult.data.id
            : null;
        if (
          !run ||
          !accountId ||
          run.accountId !== accountId ||
          run.isArchived ||
          (providerId && run.providerId !== providerId) ||
          (mode && run.mode !== mode)
        ) {
          setRuns([]);
          setActiveRunId(null);
          if (pendingRunIdRef.current === runId) dispatch(clearPendingRunId());
          return;
        }
        setRuns([run]);
        setActiveRunId(run.id);
        if (pendingRunIdRef.current === run.id) dispatch(clearPendingRunId());
        if (publishSelection) dispatch(setActiveTab(run.id));
        await loadRunDetails(run.id);
      } catch (err) {
        console.error("Failed to load routed run:", err);
        if (isCurrent()) setLoadedKey(`run:${runId}`);
      }
    },
    [providerId, mode, dispatch, loadRunDetails, publishSelection],
  );

  // The render-time swap above already put the remembered list on screen;
  // this reloads it. Transcripts are keyed by run, so a workspace switch keeps
  // them — switching back finds the last run's messages still in the LRU.
  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    const loading = (async () => {
      if (routeRunId) {
        clearState();
        await loadRoutedRun(routeRunId, isCurrent);
      } else if (workspaceId) {
        await loadWorkspaceRuns(workspaceId, isCurrent);
      }
    })();
    // Voice coordination and other windows create runs through the backend.
    // Add their tabs without selecting them. Wait for the initial list so a
    // stale list response cannot overwrite a newly announced worker.
    const revisions = new Map<string, number>();
    const offUpdated = workspaceId && !routeRunId ? appEvents.runs.onUpdated(({ runId }) => {
      const revision = (revisions.get(runId) ?? 0) + 1;
      revisions.set(runId, revision);
      void (async () => {
        await loading;
        if (!current || revisions.get(runId) !== revision) return;
        const result = await appApi.runs.getById(runId);
        if (!current || revisions.get(runId) !== revision || !result.success || !result.data) return;
        const run = result.data;
        if (run.isArchived || run.workspaceId !== workspaceId ||
            (providerId && run.providerId !== providerId) || (mode && run.mode !== mode)) return;
        setRuns((previous) => previous.some((item) => item.id === run.id)
          ? previous.map((item) => item.id === run.id ? run : item)
          : [run, ...previous]);
      })().catch((error) => console.error("Failed to refresh an updated workspace chat:", error));
    }) : undefined;
    return () => {
      current = false;
      offUpdated?.();
    };
  }, [workspaceId, routeRunId, providerId, mode, loadRoutedRun, loadWorkspaceRuns, clearState]);

  // Keep the remembered list current as runs are started, renamed, or closed.
  useEffect(() => {
    if (workspaceId && !routeRunId && loadedKey === `ws:${workspaceId}`) {
      runLists.set(workspaceId, runs);
    }
  }, [runs, workspaceId, routeRunId, loadedKey, runLists]);

  // Remember the other workspaces' lists up front, so even the first switch to
  // one lands on its tabs rather than an empty strip.
  useEffect(() => {
    for (const id of prefetchWorkspaceIds) {
      if (id === workspaceId || runLists.has(id)) continue;
      void appApi.runs
        .getByWorkspace(id, { limit: 50, providerId, mode })
        .then((result) => {
          if (result.success && result.data && !runLists.has(id)) {
            runLists.set(id, result.data);
          }
        })
        .catch(() => {});
    }
  }, [prefetchWorkspaceIds, workspaceId, runLists, providerId, mode]);

  // Same-workspace jumps (a chat sidebar click with no navigation): the mount
  // path above never re-runs, so consume the request here once its run is in
  // the loaded list. Cross-workspace jumps are consumed by the mount path,
  // which clears the request before this effect can see it.
  useEffect(() => {
    if (!pendingRunId) return;
    const target = runs.find((run) => run.id === pendingRunId);
    if (!target) return;
    dispatch(clearPendingRunId());
    // Same microtask hop as the pendingGoal sync — the consume must not set
    // state synchronously inside the effect body.
    queueMicrotask(() => {
      setActiveRunId(target.id);
      loadRunDetails(target.id);
      dispatch(setActiveTab(target.id));
    });
  }, [pendingRunId, runs, dispatch, loadRunDetails]);

  // --- Delegated subjects ---

  const { finalizeRun } = useRunSync({
    runs,
    activeRunId,
    cache,
    loadRunDetails,
    onRunUpdated,
    clearTurnStreams,
  });

  const {
    isLoading,
    error,
    createVoiceConversation,
    executeRun,
    continueRun: continueRunOperation,
    forkRun,
    executeReview,
    checkCanResume,
  } = useRunOperations({ registerNewRun, loadRunDetails, onRunUpdated });

  const continueRun = useCallback(async (...args: Parameters<typeof continueRunOperation>) => {
    const succeeded = await continueRunOperation(...args);
    if (succeeded) await loadHistory(args[0], "latest");
    return succeeded;
  }, [continueRunOperation, loadHistory]);

  // --- Derived transcript ---

  const combinedEvents = useMemo(() => {
    const dbEvents = activeRunId ? runEvents[activeRunId] || [] : [];
    if (history.historical || streamingEvents.length === 0) return dbEvents;

    // Prefer a native stream identity when the provider persists one. The final
    // text can differ from the last delta, or repeat a previous turn's text.
    const dbArtifactStreamIds = new Set(
      dbEvents.filter((e) => e.type === "artifact").map((e) => e.metadata?.streamId),
    );
    // Providers without a persisted stream identity still reconcile by content.
    const dbArtifactContents = new Set(
      dbEvents
        .filter((e) => e.type === "artifact" && e.metadata?.kind === "report")
        .map((e) => e.content.trim()),
    );

    const activeStreams = streamingEvents.filter(
      (se) => !dbArtifactStreamIds.has(se.streamId) &&
        (se.metadata?.streamId === se.streamId || !dbArtifactContents.has(se.content.trim())),
    );

    if (activeStreams.length === 0) return dbEvents;

    const streamRunEvents: RunEvent[] = activeStreams.map((se) => {
      // Live progress for codex commands (e.g. npm install) routes to the
      // AsciiLoader status line, not into the main timeline as an
      // agent-message bubble.
      const kind =
        se.kind === "user-prompt" ? "user-prompt"
          : se.kind === "image_generation" ? "image_generation"
          : se.kind === "thinking" ? "thinking"
          : se.streamId.startsWith("cursor-think-") ? "thinking"
          : se.streamId.startsWith("codex-cmd-") ? "thinking"
          : se.streamId.startsWith("claude-think-") ? "thinking"
          : "report";
      return {
        id: se.id,
        type: "artifact" as const,
        content: se.content,
        timestamp: new Date(se.timestamp),
        metadata: {
          ...se.metadata,
          kind,
          streaming: se.metadata?.streaming !== false,
          streamId: se.streamId,
        },
      };
    });

    const merged = [...dbEvents, ...streamRunEvents];
    // A spoken message stays where speech began, even if work artifacts finish
    // before its final transcript. Persisted voice messages keep this timestamp.
    if (activeStreams.some((event) => event.metadata?.voice === true)) {
      merged.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
    return merged;
  }, [activeRunId, runEvents, streamingEvents, history.historical]);
  const currentEvents = combinedEvents;

  // --- Tab operations ---

  const closeTab = useCallback(
    async (runId: string) => {
      try {
        await archiveRun(runId).unwrap();
      } catch (error) {
        console.error("[useWorkspaceRuns] Failed to archive run:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to archive run",
        );
        return;
      }

      setRuns((prev) => {
        const newRuns = prev.filter((r) => r.id !== runId);
        if (activeRunId === runId && newRuns.length > 0) {
          setActiveRunId(newRuns[0].id);
          loadRunDetails(newRuns[0].id);
        } else if (newRuns.length === 0) {
          setActiveRunId(null);
        }
        return newRuns;
      });
      // Drop from the LRU + incremental bookkeeping so reopening re-fetches fresh.
      cache.forget(runId);
      forgetHistory(runId);
    },
    [activeRunId, archiveRun, loadRunDetails, cache, forgetHistory],
  );

  const selectTab = useCallback(
    (runId: string) => {
      const revision = selectionRevisionRef.current;
      const wasPending = runs.some(
        (run) =>
          run.id === runId &&
          (run.status === "running" || run.status === "queued"),
      );

      setActiveRunId(runId);

      // Always reconcile on tab focus. Besides refreshing the transcript,
      // this is the immediate fallback for a dropped/backgrounded status push.
      void loadRunDetails(runId);
      void (async () => {
        const result = await appApi.runs.getById(runId);
        if (revision !== selectionRevisionRef.current || !result.success || !result.data) return;
        const run = result.data;
        if (run.isArchived ||
          (providerId && run.providerId !== providerId) ||
          (mode && run.mode !== mode) ||
          (workspaceId && run.workspaceId !== workspaceId)) return;

        // The other renderer can create a run after this window loaded its
        // workspace. Selecting it must also make its tab available locally.
        setRuns((previous) => previous.some((item) => item.id === run.id)
          ? previous.map((item) => item.id === run.id ? run : item)
          : [run, ...previous]);
        if (wasPending) await finalizeRun(run);
      })();
    },
    [runs, loadRunDetails, finalizeRun, workspaceId, providerId, mode],
  );

  const activeRun = runs.find((r) => r.id === activeRunId);
  // The active run's transcript hasn't arrived yet (first open, or evicted from
  // the LRU) — distinct from a run that genuinely has no events.
  const isTranscriptLoading = activeRunId !== null && !(activeRunId in runEvents);
  const currentTurns = useMemo(
    () => (activeRunId ? runTurns[activeRunId] || [] : []),
    [activeRunId, runTurns],
  );

  return {
    runs,
    runsLoaded,
    setRuns,
    activeRunId,
    activeRun,
    runEvents,
    currentEvents,
    isTranscriptLoading,
    currentTurns,
    runTurns,
    isRunDetailsLoaded: cache.isLoaded,
    loadRunDetails,
    isLoading,
    error,
    eventsEndRef,
    history,
    setActiveRunId,
    createVoiceConversation,
    executeRun,
    continueRun,
    forkRun,
    executeReview,
    checkCanResume,
    closeTab,
    selectTab,
  };
}
