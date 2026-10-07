import { and, asc, desc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";

import { backendSession, useSession } from "@/backend/backend-session";
import {
  clearStreamingMessages,
  reconcileStreamingMessages,
  useStreamingMessages,
} from "@/backend/streaming-messages";
import { db } from "@/db/client";
import { useRunHistory } from "@/backend/run-history";
import { pendingApprovals, runArtifacts, runs, toolCalls, workspaces } from "@/db/schema";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";
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

  const runQuery = useLiveQuery(
    db.select().from(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).limit(1),
    [backendId, runId],
  );
  // Before the first remote page arrives, even an old/offline phone cache
  // must not materialize a whole conversation. Once synced, SQLite contains
  // only the selected backend window for this run.
  const cachedArtifacts = db.select().from(runArtifacts)
    .where(and(eq(runArtifacts.backendId, backendId), eq(runArtifacts.runId, runId)))
    .orderBy(desc(runArtifacts.createdAt), desc(runArtifacts.id));
  const artifactQuery = useCoalescedLiveQuery(
    history.loaded ? cachedArtifacts : cachedArtifacts.limit(200), runArtifacts,
    [backendId, runId, history.loaded],
  );
  const cachedCalls = db.select().from(toolCalls)
    .where(and(eq(toolCalls.backendId, backendId), eq(toolCalls.runId, runId)))
    .orderBy(desc(toolCalls.createdAt), desc(toolCalls.id));
  const callQuery = useCoalescedLiveQuery(
    history.loaded ? cachedCalls : cachedCalls.limit(200), toolCalls,
    [backendId, runId, history.loaded],
  );
  const approvalQuery = useLiveQuery(
    db
      .select()
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.backendId, backendId), eq(pendingApprovals.runId, runId)))
      .orderBy(asc(pendingApprovals.requestedAt)),
    [backendId, runId],
  );

  const run = runQuery.data[0];
  // Until the run row lands, retain the provider the initial send targeted.
  const providerId = run?.providerId ?? expectedProviderId ?? "";
  const workspaceQuery = useLiveQuery(
    db
      .select({ rootPath: workspaces.rootPath })
      .from(workspaces)
      .where(and(eq(workspaces.backendId, backendId), eq(workspaces.id, run?.workspaceId ?? "")))
      .limit(1),
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
  const modelSelection = useModelSelection(backendId, providerId);

  return {
    backend: {
      id: backendId,
      connected: session.connection.kind === "connected",
    },
    run: {
      record: run,
      isLive: runIsLive,
      providerId,
      mode: isModeId(run?.mode) ? run.mode : DEFAULT_MODE_ID,
      workspacePath: workspaceQuery.data[0]?.rootPath ?? null,
    },
    transcript: {
      items,
      streamingItems: history.end ? [] : streamingItems,
      promptCount,
      thinking,
      history,
    },
    approvals: {
      waiting: waitingApprovals,
      now,
    },
    modelSelection,
  };
}
