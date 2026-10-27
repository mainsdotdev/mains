import { and, asc, eq } from "drizzle-orm";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";

import { backendSession, useSession } from "@/backend/backend-session";
import {
  clearStreamingMessages,
  reconcileStreamingMessages,
  useStreamingMessages,
} from "@/backend/streaming-messages";
import { db } from "@/db/client";
import { cachedHistoryQueries } from "@/db/history-queries";
import { useRunHistory } from "@/backend/run-history";
import { pendingApprovals, runArtifacts, runs, toolCalls, workspaces } from "@/db/schema";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";
import { pendingAsyncQuestions } from "@/lib/async-questions";
import { latestPromptSuggestions } from "@/lib/prompt-suggestions";
import { buildTranscript } from "@/lib/transcript";
import { useModelSelection } from "@/lib/use-model-selection";
import { useNow } from "@/lib/use-now";
import { isModeId, DEFAULT_MODE_ID } from "@mains/contracts/modes";

import { latestThinking } from "../lib/latest-thinking";
import { projectStreamingTranscript } from "../lib/run-transcript-projection";

/**
 * The read side of a run screen: its durable projection, transient assistant
 * text, expiry-aware approvals, and provider/workspace settings.
 *
 * The screen owns interaction state. This hook owns every subscription and
 * query needed to turn a `(backend, run)` pair into render-ready run data.
 */
export function useRunData(runId: string, expectedProviderId: string | null) {
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const history = useRunHistory(backendId, runId);

  // While this transcript is on screen its backend events trigger refetches.
  useFocusEffect(
    useCallback(() => {
      if (!runId) return;
      backendSession.openRun(runId);
      return () => backendSession.closeRun(runId);
    }, [runId]),
  );

  const runQuery = useCoalescedLiveQuery(
    db.select().from(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).limit(1),
    runs,
    [backendId, runId],
  );
  // Before the first remote page arrives, even an old/offline phone cache
  // must not materialize a whole conversation. Once synced, SQLite contains
  // only the selected backend window for this run.
  const cached = cachedHistoryQueries(db, backendId, runId);
  const artifactQuery = useCoalescedLiveQuery(
    cached.artifacts, runArtifacts, [backendId, runId],
  );
  const callQuery = useCoalescedLiveQuery(
    cached.calls, toolCalls, [backendId, runId],
  );
  const approvalQuery = useCoalescedLiveQuery(
    db
      .select()
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.backendId, backendId), eq(pendingApprovals.runId, runId)))
      .orderBy(asc(pendingApprovals.requestedAt)),
    pendingApprovals,
    [backendId, runId],
  );

  const run = runQuery.data[0];
  // Until the run row lands, retain the provider the initial send targeted.
  const providerId = run?.providerId ?? expectedProviderId ?? "";
  const workspaceQuery = useCoalescedLiveQuery(
    db
      .select({ rootPath: workspaces.rootPath })
      .from(workspaces)
      .where(and(eq(workspaces.backendId, backendId), eq(workspaces.id, run?.workspaceId ?? "")))
      .limit(1),
    workspaces,
    [backendId, run?.workspaceId],
  );

  const items = useMemo(
    () => buildTranscript(artifactQuery.data, callQuery.data),
    [artifactQuery.data, callQuery.data],
  );
  const streamingMessages = useStreamingMessages(runId);
  const { persistedResponseContents, streamingItems } = useMemo(
    () => projectStreamingTranscript(items, streamingMessages),
    [items, streamingMessages],
  );

  useEffect(() => {
    reconcileStreamingMessages(runId, persistedResponseContents);
  }, [persistedResponseContents, runId]);

  const runIsLive = run?.status === "running" || run?.status === "queued";
  useEffect(() => {
    if (run && !runIsLive) clearStreamingMessages(runId);
  }, [run, runId, runIsLive]);

  const promptCount = useMemo(
    () => items.filter((item) => item.kind === "prompt").length,
    [items],
  );
  const now = useNow(1000, approvalQuery.data.length > 0);
  const waitingApprovals = useMemo(
    () => approvalQuery.data.filter((approval) => approval.expiresAt.getTime() > now),
    [approvalQuery.data, now],
  );
  const thinking = useMemo(() => latestThinking([...artifactQuery.data].reverse()), [artifactQuery.data]);
  const suggestions = useMemo(() => latestPromptSuggestions(artifactQuery.data), [artifactQuery.data]);
  const asyncQuestions = useMemo(() => pendingAsyncQuestions(artifactQuery.data), [artifactQuery.data]);
  const modelSelection = useModelSelection(backendId, providerId, runId);

  const readingCache = [runQuery, artifactQuery, callQuery].some(
    (query) => !query.updatedAt && !query.error,
  );
  const hasCachedHistory = artifactQuery.data.length > 0 || callQuery.data.length > 0;
  // A remote page is committed before the coalesced queries read it. Keep
  // waiting for a nonempty page to reach those queries; a truly empty page
  // can show the empty state. Existing cached messages stay visible on refresh.
  const awaitingFirstPage = session.connection.kind === "connected" &&
    !hasCachedHistory && !history.error &&
    ((!history.loaded && (history.loading || Boolean(run))) || history.start !== null);

  return {
    loading: Boolean(runId) && (readingCache || awaitingFirstPage),
    backend: {
      id: backendId,
      connected: session.connection.kind === "connected",
    },
    run: {
      record: run,
      isLive: runIsLive,
      /** Another computer's conversation (Bridge): read here, never continued. */
      isReplica: run?.isReplica === true,
      providerId,
      mode: isModeId(run?.mode) ? run.mode : DEFAULT_MODE_ID,
      workspacePath: workspaceQuery.data[0]?.rootPath ?? null,
    },
    transcript: {
      items,
      streamingItems: history.end ? [] : streamingItems,
      promptCount,
      thinking,
      /** Follow-ups offered after the latest answer, until the user's next message. */
      suggestions,
      history,
    },
    approvals: {
      waiting: waitingApprovals,
      /** Codex's end-of-turn questions still waiting on the user, if any. */
      questions: asyncQuestions,
      now,
    },
    modelSelection,
  };
}
