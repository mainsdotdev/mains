import type {
  DriverOutcome,
  WorkRunEvent,
  WorkRunEventHandler,
} from "../../../../shared/adapter.types";
import {
  cancelPendingRequest,
  cancelPendingRequests,
} from "../../runs/user-input-broker";
import {
  createLogger,
  extractArtifactsFromToolOutput,
  type AdapterLogger,
} from "./adapter.shared";
import type { CodexAppServer } from "./codex-app-server.client";
import {
  createCodexEventMapper,
  createCodexEventRunState,
  type CodexEventRunState,
  type CodexSubAgentRunMeta,
} from "./codex-event-mapper";
import type { MainsToolContext } from "./mains-tools.core";
import { createCodexRequestBroker } from "./codex-request-broker";

export interface CodexRunSession {
  runId: string;
  startTurn: () => Promise<void>;
  model: string | undefined;
  timeout: number;
  preExecuteEvent?: WorkRunEvent;
}

export type CodexActiveRunState = CodexEventRunState & {
  subscribedThreadIds: Set<string>;
  aborted: boolean;
  timeoutError?: string;
  approvedElicitationServers?: Set<string>;
};

interface CodexRunCoordinatorOptions {
  /** Getter, not a value — the driver's config object is refreshed in place. */
  getDefaultModel?: () => string | undefined;
  onReviewCompleted?: (
    runId: string,
    itemId: string,
    reviewText: string,
  ) => void;
  logger?: AdapterLogger;
}

interface RegisterRunParams {
  runId: string;
  threadId: string | null;
  mainsCtx: MainsToolContext;
  subAgents?: CodexSubAgentRunMeta[];
}

interface TurnCompletion {
  status: "succeeded" | "failed" | "canceled";
  error?: string;
}

interface CodexRunSink {
  handleNotification: (
    method: string,
    params: unknown,
  ) => Promise<void>;
  handleServerRequest: (
    id: number | string,
    method: string,
    params: unknown,
  ) => Promise<void>;
  notificationQueue: Promise<void>;
  finalize: (result: TurnCompletion) => void;
}

/**
 * Owns one Codex driver's live run/session state and its turn lifecycle.
 *
 * The coordinator serializes notifications per run, routes thread-scoped
 * server traffic, guarantees exactly-once finalization, and centralizes
 * timeout/abort/cleanup semantics.
 */
export function createCodexRunCoordinator(
  options: CodexRunCoordinatorOptions = {},
) {
  const logger =
    options.logger ?? createLogger("[CodexRunCoordinator]");
  const activeRuns = new Map<string, CodexActiveRunState>();
  const sessionIdMap = new Map<string, string>();
  const runSinks = new Map<string, CodexRunSink>();
  const serverRequestOwners = new Map<string, string>();
  const turnOwners = new Map<string, string>();
  // Child threads outlive an individual turn/run execution. Keep their
  // identity and original spawn anchor while the parent Codex session is
  // resumable so Continue can re-arm the same panel row.
  const sessionSubAgents = new Map<
    string,
    Map<string, CodexSubAgentRunMeta>
  >();

  const eventMapper = createCodexEventMapper({
    getRunState: (runId) => activeRuns.get(runId),
    onReviewCompleted: options.onReviewCompleted,
    onParentThreadStarted: (runId, threadId) => {
      sessionIdMap.set(runId, threadId);
    },
    getDefaultModel: options.getDefaultModel,
  });
  const requestBroker = createCodexRequestBroker({
    getRunState: (runId) => activeRuns.get(runId),
    getMainsToolContext: (runId) =>
      activeRuns.get(runId)?.mainsCtx,
    logger,
  });

  function registerRun(params: RegisterRunParams): void {
    const { runId, threadId, mainsCtx } = params;
    if (threadId) sessionIdMap.set(runId, threadId);
    const state = createCodexEventRunState(threadId, mainsCtx);
    const subAgents = threadId
      ? sessionSubAgents.get(threadId) ?? new Map()
      : new Map<string, CodexSubAgentRunMeta>();
    for (const seed of params.subAgents ?? []) {
      const existing = subAgents.get(seed.threadId);
      const merged: CodexSubAgentRunMeta = {
        ...existing,
        threadId: seed.threadId,
      };
      Object.assign(
        merged,
        Object.fromEntries(
          Object.entries(seed).filter(([, value]) => value !== undefined),
        ),
      );
      subAgents.set(seed.threadId, merged);
    }
    state.subAgents = subAgents;
    if (threadId) sessionSubAgents.set(threadId, subAgents);
    activeRuns.set(runId, {
      ...state,
      subscribedThreadIds: new Set(
        threadId ? [threadId] : [],
      ),
      aborted: false,
    });
  }

  function attachThread(
    runId: string,
    threadId: string,
    turnId?: string,
  ): void {
    sessionIdMap.set(runId, threadId);
    const state = activeRuns.get(runId);
    if (!state) return;
    state.subscribedThreadIds.add(threadId);
    state.threadId = threadId;
    sessionSubAgents.set(threadId, state.subAgents);
    if (turnId !== undefined) state.turnId = turnId;
  }

  function ensureSubAgent(
    state: CodexActiveRunState,
    threadId: string,
    details: Partial<CodexSubAgentRunMeta> = {},
  ): CodexSubAgentRunMeta {
    const existing = state.subAgents.get(threadId);
    const meta: CodexSubAgentRunMeta = {
      ...existing,
      threadId,
    };
    // Fresh provider metadata is authoritative, but an undefined field from a
    // partial notification must not blank lifecycle state captured earlier.
    Object.assign(
      meta,
      Object.fromEntries(
        Object.entries(details).filter(([, value]) => value !== undefined),
      ),
    );
    state.subAgents.set(threadId, meta);
    return meta;
  }

  function getSessionThread(runId: string): string | undefined {
    return sessionIdMap.get(runId);
  }

  function hasSessionSubAgentState(runId: string): boolean {
    const threadId = sessionIdMap.get(runId);
    return !!threadId && sessionSubAgents.has(threadId);
  }

  function getInterruptedSubAgents(
    runId: string,
  ): CodexSubAgentRunMeta[] {
    const state = activeRuns.get(runId);
    if (!state) return [];
    return [...state.subAgents.values()]
      .filter(
        (meta) =>
          meta.terminalPhase === "stopped" &&
          !!meta.spawnItemId,
      )
      .map((meta) => ({ ...meta }));
  }

  function findRunIdForThread(
    threadId: string | undefined,
  ): string | null {
    if (!threadId) return null;
    for (const [runId, candidateThreadId] of sessionIdMap) {
      if (candidateThreadId === threadId) return runId;
    }
    return null;
  }

  function requestThreadId(params: unknown): string | undefined {
    const requestParams =
      params as Record<string, unknown> | undefined;
    return (
      requestParams?.threadId ?? requestParams?.thread_id
    ) as string | undefined;
  }

  function requestTurnId(params: unknown): string | undefined {
    const requestParams =
      params as Record<string, unknown> | undefined;
    const turn = requestParams?.turn as
      | Record<string, unknown>
      | undefined;
    return (
      requestParams?.turnId ??
      requestParams?.turn_id ??
      turn?.id
    ) as string | undefined;
  }

  function deleteTurnOwnersForRun(runId: string): void {
    for (const [turnId, ownerRunId] of turnOwners) {
      if (ownerRunId === runId) turnOwners.delete(turnId);
    }
  }

  function runIdForLiveThread(
    method: string,
    params: unknown,
  ): string | undefined {
    const requestParams =
      params as Record<string, unknown> | undefined;
    const thread = requestParams?.thread as
      | Record<string, unknown>
      | undefined;
    const directThreadId =
      requestThreadId(params) ??
      (thread?.id as string | undefined);
    const parentThreadId = thread?.parentThreadId as
      | string
      | null
      | undefined;
    const directTurnId = requestTurnId(params);

    if (directTurnId) {
      const ownerRunId = turnOwners.get(directTurnId);
      if (ownerRunId && runSinks.has(ownerRunId)) {
        return ownerRunId;
      }
    }

    for (const runId of runSinks.keys()) {
      const state = activeRuns.get(runId);
      if (!state) continue;
      if (
        directThreadId &&
        (
          state.threadId === directThreadId ||
          state.subAgents.has(directThreadId)
        )
      ) {
        return runId;
      }
      if (
        method === "thread/started" &&
        parentThreadId &&
        (
          state.threadId === parentThreadId ||
          state.subAgents.has(parentThreadId)
        )
      ) {
        return runId;
      }
    }

    if (!directThreadId && runSinks.size === 1) {
      return runSinks.keys().next().value as
        | string
        | undefined;
    }
    return undefined;
  }

  function installDispatcher(server: CodexAppServer): void {
    server.setNotificationHandler((method, params) => {
      if (method === "serverRequest/resolved") {
        const requestId = (
          params as Record<string, unknown> | undefined
        )?.requestId;
        if (
          typeof requestId === "string" ||
          typeof requestId === "number"
        ) {
          cancelPendingRequest(String(requestId));
          serverRequestOwners.delete(String(requestId));
        }
      }

      const runId = runIdForLiveThread(method, params);
      if (!runId) return;
      const state = activeRuns.get(runId);
      const requestParams = params as
        | Record<string, unknown>
        | undefined;
      const thread = requestParams?.thread as
        | Record<string, unknown>
        | undefined;
      if (state && method === "thread/started") {
        const childThreadId = (
          thread?.id ?? requestThreadId(params)
        ) as string | undefined;
        const parentThreadId = (
          thread?.parentThreadId ?? thread?.parent_thread_id
        ) as string | undefined;
        if (
          childThreadId &&
          parentThreadId &&
          (
            parentThreadId === state.threadId ||
            state.subAgents.has(parentThreadId)
          )
        ) {
          ensureSubAgent(state, childThreadId, {
            nickname: thread?.agentNickname as string | undefined,
            role: thread?.agentRole as string | undefined,
          });
        }
      }

      // Collaboration items are emitted on the parent before the child turn.
      // Capture their receiver ids synchronously so a child turn/started in
      // the same stdout chunk cannot outrun the mapper's async queue.
      if (state && method.startsWith("item/")) {
        const item = (requestParams?.item ?? requestParams) as
          | Record<string, unknown>
          | undefined;
        const itemType = item?.type as string | undefined;
        if (
          itemType === "subAgentActivity" ||
          itemType === "sub_agent_activity"
        ) {
          const childThreadId = (
            item?.agentThreadId ?? item?.agent_thread_id
          ) as string | undefined;
          if (childThreadId) ensureSubAgent(state, childThreadId);
        } else if (
          itemType === "collabAgentToolCall" ||
          itemType === "collab_agent_tool_call"
        ) {
          const receiverThreadIds = (
            item?.receiverThreadIds ?? item?.receiver_thread_ids
          ) as string[] | undefined;
          for (const childThreadId of receiverThreadIds ?? []) {
            ensureSubAgent(state, childThreadId);
          }
        }
      }

      const turnId = requestTurnId(params);
      if (method === "turn/started" && turnId) {
        // Several current notifications (notably turn/plan/updated) carry a
        // turnId but no threadId. Capture ownership synchronously, before the
        // per-run async notification queue processes turn/started.
        turnOwners.set(turnId, runId);
        const threadId = requestThreadId(params);
        if (state && threadId) {
          if (!state.threadId || threadId === state.threadId) {
            state.turnId = turnId;
          } else {
            ensureSubAgent(state, threadId).activeTurnId = turnId;
          }
        }
      } else if (method === "turn/completed" && turnId && state) {
        const threadId = requestThreadId(params);
        if (threadId === state.threadId && state.turnId === turnId) {
          state.turnId = null;
        } else if (threadId) {
          const meta = state.subAgents.get(threadId);
          if (meta?.activeTurnId === turnId) {
            meta.activeTurnId = undefined;
          }
        }
      }
      const sink = runSinks.get(runId);
      if (!sink) return;

      sink.notificationQueue = sink.notificationQueue
        .then(() => sink.handleNotification(method, params))
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);
          logger.error(
            `Notification handler failed for ${runId}:`,
            message,
          );
          sink.finalize({
            status: "failed",
            error: `Codex event handling failed: ${message}`,
          });
        });
    });

    server.setServerRequestHandler((id, method, params) => {
      const runId = runIdForLiveThread(method, params);
      const sink = runId ? runSinks.get(runId) : undefined;
      if (!runId || !sink) {
        requestBroker.rejectInactive(server, id, method);
        return;
      }

      serverRequestOwners.set(String(id), runId);
      void sink
        .handleServerRequest(id, method, params)
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);
          logger.error(
            `Server request handler failed for ${runId}:`,
            message,
          );
          server.respondToRequestError(id, -32603, message);
        });
    });
  }

  async function interruptRunTurns(
    server: CodexAppServer,
    runId: string,
    logMessage: string,
  ): Promise<void> {
    const state = activeRuns.get(runId);
    if (!server.isRunning || !state) return;

    const targets: Array<{ threadId: string; turnId: string }> = [];
    if (state.threadId && state.turnId) {
      targets.push({ threadId: state.threadId, turnId: state.turnId });
    }
    for (const meta of state.subAgents.values()) {
      if (meta.activeTurnId) {
        targets.push({
          threadId: meta.threadId,
          turnId: meta.activeTurnId,
        });
      }
    }

    await Promise.all(
      targets.map((target) =>
        server
          .sendRequest("turn/interrupt", target, 250)
          .catch((error) =>
            logger.warn(
              `${logMessage} ${target.threadId}/${target.turnId}:`,
              error,
            ),
          ),
      ),
    );
  }

  function waitForTurnCompletion(
    server: CodexAppServer,
    runId: string,
    model: string | undefined,
    onEvent: WorkRunEventHandler,
    timeout: number,
  ): Promise<TurnCompletion> {
    return new Promise((resolve) => {
      let resolved = false;

      const finalize = (result: TurnCompletion) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutTimer);
        if (runSinks.get(runId) === sink) {
          runSinks.delete(runId);
        }
        deleteTurnOwnersForRun(runId);
        for (
          const [requestId, ownerRunId]
          of serverRequestOwners
        ) {
          if (ownerRunId === runId) {
            serverRequestOwners.delete(requestId);
          }
        }
        cancelPendingRequests(runId);
        resolve(result);
      };

      const timeoutTimer = setTimeout(() => {
        const timeoutError = `Codex run timed out after ${timeout}ms`;
        const state = activeRuns.get(runId);
        if (state) state.timeoutError = timeoutError;
        void interruptRunTurns(
          server,
          runId,
          "Failed to interrupt timed-out turn",
        ).finally(() =>
          finalize({
            status: "failed",
            error: timeoutError,
          }),
        );
      }, timeout);

      const handleNotification = async (
        method: string,
        params: unknown,
      ) => {
        const state = activeRuns.get(runId);

        if (state && state.pendingFlush.length > 0) {
          const flushed = state.pendingFlush.splice(0);
          for (const event of flushed) {
            await onEvent(event);
          }
        }

        if (method === "item/completed") {
          await eventMapper.maybeResolveCollabSubAgents(
            server,
            params,
            runId,
          );
        }

        const mappedEvents = eventMapper.mapNotification(
          method,
          params,
          runId,
          model,
        );
        for (const mapped of mappedEvents) {
          await onEvent(mapped);
          if (
            mapped.type === "tool_call" &&
            mapped.output &&
            mapped.metadata?.phase === "complete"
          ) {
            const artifacts = extractArtifactsFromToolOutput(
              mapped.toolName,
              mapped.output,
            );
            for (const artifact of artifacts) {
              await onEvent(artifact);
            }
          }
        }

        if (method === "turn/completed") {
          const completionParams =
            params as Record<string, unknown> | undefined;
          const completedThreadId = (
            completionParams?.threadId ??
            completionParams?.thread_id
          ) as string | undefined;
          const currentState = activeRuns.get(runId);
          if (
            completedThreadId &&
            currentState?.threadId &&
            completedThreadId !== currentState.threadId
          ) {
            return;
          }

          const turn = completionParams?.turn as
            | Record<string, unknown>
            | undefined;
          const status = (
            turn?.status ?? completionParams?.status
          ) as string | undefined;
          const timeoutError = currentState?.timeoutError;
          const resolvedStatus:
            | "succeeded"
            | "failed"
            | "canceled" =
            timeoutError || status === "failed"
              ? "failed"
              : status === "interrupted"
                ? "canceled"
                : "succeeded";
          finalize({
            status: resolvedStatus,
            error:
              resolvedStatus === "failed"
                ? timeoutError ??
                  (
                    turn?.error as
                      | { message?: string }
                      | undefined
                  )?.message ??
                  "Turn failed"
                : undefined,
          });
        } else if (method === "error") {
          const errorParams =
            params as Record<string, unknown> | undefined;
          const willRetry = errorParams?.willRetry as
            | boolean
            | undefined;
          if (!willRetry) {
            const message =
              (
                errorParams?.error as
                  | { message?: string }
                  | undefined
              )?.message ??
              (errorParams?.message as string) ??
              "Error";
            finalize({ status: "failed", error: message });
          }
        }
      };

      const handleServerRequest = (
        id: number | string,
        method: string,
        params: unknown,
      ) =>
        requestBroker.handleRequest({
          server,
          id,
          method,
          params,
          runId,
          runIsDead:
            resolved ||
            activeRuns.get(runId)?.aborted === true,
        });

      const sink: CodexRunSink = {
        handleNotification,
        handleServerRequest,
        notificationQueue: Promise.resolve(),
        finalize,
      };
      const previous = runSinks.get(runId);
      if (previous) {
        previous.finalize({
          status: "failed",
          error: "A newer Codex turn replaced this run",
        });
      }
      runSinks.set(runId, sink);
    });
  }

  async function executeTurn(
    server: CodexAppServer | null,
    session: CodexRunSession,
    onEvent: WorkRunEventHandler,
    signal: AbortSignal,
  ): Promise<DriverOutcome> {
    if (signal.aborted) {
      const state = activeRuns.get(session.runId);
      if (state) state.aborted = true;
      return { status: "canceled" };
    }

    const onAbort = () => {
      const state = activeRuns.get(session.runId);
      if (state) state.aborted = true;
      const interruption = server
        ? interruptRunTurns(
            server,
            session.runId,
            "Failed to interrupt turn",
          )
        : Promise.resolve();
      void interruption.finally(async () => {
        const sink = runSinks.get(session.runId);
        if (!sink) return;
        await sink.notificationQueue;
        sink.finalize({ status: "canceled" });
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      if (!server?.isRunning) {
        throw new Error("Codex app-server is not running");
      }

      if (session.preExecuteEvent) {
        await onEvent(session.preExecuteEvent);
        if (signal.aborted) return { status: "canceled" };
      }

      const completion = waitForTurnCompletion(
        server,
        session.runId,
        session.model,
        onEvent,
        session.timeout,
      );
      try {
        await session.startTurn();
      } catch (error) {
        runSinks.get(session.runId)?.finalize({
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
        await completion;
        throw error;
      }
      const result = await completion;
      return {
        status: result.status,
        summary: result.error,
        usage: eventMapper.flushUsage(session.runId),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error("executeTurn failed:", message);
      eventMapper.flushUsage(session.runId);
      return { status: "failed", summary: message };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function cleanupRun(
    server: CodexAppServer | null,
    runId: string,
  ): Promise<void> {
    const state = activeRuns.get(runId);
    if (server?.isRunning && state) {
      for (const threadId of state.subscribedThreadIds) {
        try {
          await server.sendRequest("thread/unsubscribe", {
            threadId,
          });
        } catch (error) {
          logger.warn(
            `Failed to unsubscribe Codex thread ${threadId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
    activeRuns.delete(runId);
    deleteTurnOwnersForRun(runId);
  }

  function deleteRun(runId: string): void {
    const threadId = sessionIdMap.get(runId);
    if (threadId) sessionSubAgents.delete(threadId);
    sessionIdMap.delete(runId);
    activeRuns.delete(runId);
    deleteTurnOwnersForRun(runId);
    eventMapper.discardRun(runId);
  }

  function handleServerClose(): void {
    for (const sink of [...runSinks.values()]) {
      sink.finalize({
        status: "failed",
        error: "Codex app-server exited unexpectedly",
      });
    }
  }

  function shutdown(): void {
    for (const [runId, state] of activeRuns) {
      state.aborted = true;
      cancelPendingRequests(runId);
    }
    activeRuns.clear();
    sessionIdMap.clear();
    sessionSubAgents.clear();
    eventMapper.clear();
    for (const sink of [...runSinks.values()]) {
      sink.finalize({
        status: "canceled",
        error: "Codex driver is shutting down",
      });
    }
    runSinks.clear();
    serverRequestOwners.clear();
    turnOwners.clear();
  }

  return {
    attachThread,
    cleanupRun,
    deleteRun,
    executeTurn,
    findRunIdForThread,
    getInterruptedSubAgents,
    getSessionThread,
    hasSessionSubAgentState,
    handleServerClose,
    installDispatcher,
    registerRun,
    shutdown,
  };
}

export type CodexRunCoordinator = ReturnType<
  typeof createCodexRunCoordinator
>;
