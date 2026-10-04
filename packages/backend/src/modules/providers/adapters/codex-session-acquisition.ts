import { buildCodexTurnInput } from "./codex-turn-input";
import type {
  AcquiredSession,
  CodexAdapterConfig,
  RunExecutionContext,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunForkRequest,
  WorkRunRequest,
  WorkRunReviewRequest,
  WorkRunRealtimeRequest,
} from "../../../../shared/adapter.types";
import {
  createLogger,
  type AdapterLogger,
} from "./adapter.shared";
import type { CodexAppServer } from "./codex-app-server.client";
import type { CollaborationMode } from "./codex-app-server-protocol/generated/CollaborationMode";
import type { CodexAppServerParams } from "./codex-app-server-protocol/rpc";
import type { MainsToolContext } from "./mains-tools.core";
import { toCodexDynamicTools } from "./mains-tools.registry";
import { MainsMcpStdioServer } from "./mains-mcp-server";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type {
  CodexRunCoordinator,
  CodexRunSession,
} from "./codex-run-coordinator";
import type { CodexSubAgentRunMeta } from "./codex-event-mapper";

export const CODEX_ARCHIVED_CHAT_MESSAGE =
  "This chat is archived in Codex. Unarchive it in Codex to continue, or archive it in Mains to hide it from this workspace.";

const VALID_SANDBOX_MODES = new Set([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
type CodexConfigOverrides = NonNullable<
  CodexAppServerParams<"thread/start">["config"]
>;
type CodexOutputSchema = Exclude<
  CodexAppServerParams<"turn/start">["outputSchema"],
  null | undefined
>;
// `dynamicTools` and `collaborationMode` are experimental fields, present in
// the generated snapshot because it is generated with `--experimental` and the
// driver negotiates `experimentalApi: true`. No local widening needed.
type CodexThreadStartParams = CodexAppServerParams<"thread/start">;
type CodexTurnStartParams = CodexAppServerParams<"turn/start">;

interface CodexSessionAcquisitionOptions {
  config: CodexAdapterConfig;
  ensureServer: (cwd?: string) => Promise<CodexAppServer>;
  runCoordinator: CodexRunCoordinator;
  findPersistedSession: (
    runId: string,
  ) => Promise<string | undefined>;
  findPersistedSubAgents?: (
    runId: string,
  ) => Promise<CodexSubAgentRunMeta[]>;
  persistSession: (
    runId: string,
    threadId: string,
  ) => Promise<void>;
  /**
   * The live catalog's default, for a run that names no model and a config
   * that pins none. The app-server refuses a `thread/resume` without one
   * ("missing field `model`"), so this is what keeps a continued run alive.
   */
  resolveDefaultModel?: () => Promise<string | undefined>;
  /**
   * Resolve a requested/persisted model against live account availability.
   * Codex uses this to move exhausted ordinary usage onto a reserve model.
   */
  resolveModel?: (
    requestedModel: string | null | undefined,
  ) => Promise<string | undefined>;
  establishGoal: (
    server: CodexAppServer,
    threadId: string | undefined,
    goalMode: boolean,
    objective: string | undefined,
    rootPath: string | undefined,
    overwrite: boolean,
  ) => Promise<void>;
  logger?: AdapterLogger;
}

function codexErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCodexArchivedThreadError(
  error: unknown,
): boolean {
  return /\b(?:session|thread)\b[^\n]*\bis archived\b/i.test(
    codexErrorMessage(error),
  );
}

export function isCodexMissingThreadError(error: unknown): boolean {
  return (
    /\b(?:session|thread)\b[^\n]*\bnot found\b/i.test(
      codexErrorMessage(error),
    ) ||
    /\b(?:missing|unknown) thread\b|\b(?:session|thread)\b[^\n]*\bdoes not exist\b/i.test(
      codexErrorMessage(error),
    )
  );
}

export function isCodexUnavailableThreadError(
  error: unknown,
): boolean {
  return (
    isCodexArchivedThreadError(error) ||
    isCodexMissingThreadError(error)
  );
}

export function normalizeCodexResumeError(
  error: unknown,
): Error {
  if (isCodexArchivedThreadError(error)) {
    return new Error(CODEX_ARCHIVED_CHAT_MESSAGE);
  }
  return error instanceof Error
    ? error
    : new Error(String(error));
}

export function mapSandboxMode(
  mode?: string,
): "read-only" | "workspace-write" | "danger-full-access" {
  return mode && VALID_SANDBOX_MODES.has(mode)
    ? mode as
        | "read-only"
        | "workspace-write"
        | "danger-full-access"
    : "workspace-write";
}

function resolveOutputSchema(
  config: CodexAdapterConfig,
): CodexOutputSchema | undefined {
  const selectedId = config.structuredOutputsSelectedId;
  if (!selectedId) return undefined;
  return config.structuredOutputs?.[selectedId]?.schema as
    | CodexOutputSchema
    | undefined;
}

function buildCodexConfigOverrides(
  networkAccess: boolean,
  additionalDirectories: string[],
): CodexConfigOverrides {
  return {
    sandbox_workspace_write: {
      network_access: networkAccess,
      writable_roots: additionalDirectories,
    },
  };
}

/**
 * Mode-resolved instruction delta as `thread/start` / `thread/resume` params.
 * Uses the app-server's top-level `developerInstructions` field — deliberately
 * NOT `collaboration_mode.settings.developer_instructions`, which the plan
 * toggle resets (see buildCollaborationMode); the two stay orthogonal.
 */
export function buildDeveloperInstructionsParam(
  extraInstructions: string | null | undefined,
): Record<string, unknown> {
  return extraInstructions ? { developerInstructions: extraInstructions } : {};
}

export function buildCollaborationMode(
  planEnabled: boolean,
  model: string | undefined,
  effort: string | undefined,
  forceReset = false,
): CollaborationMode | undefined {
  if (!planEnabled && !forceReset) return undefined;
  // `settings.model` is required, and there is no way to spell "leave it
  // alone": blanking it fails the turn with "The '' model is not supported",
  // and omitting it fails the whole request with `Invalid request: missing
  // field \`model\``. With no model to name, the only valid request is one
  // that carries no collaboration block at all — which leaves a fork on the
  // thread's own mode, the outcome the absent model was reaching for.
  if (!model) return undefined;
  return {
    mode: planEnabled ? "plan" : "default",
    settings: {
      model,
      reasoning_effort:
        effort || (planEnabled ? "medium" : null),
      developer_instructions: null,
    },
  };
}

export function buildCodexReviewTarget(
  target: WorkRunReviewRequest["target"],
): CodexAppServerParams<"review/start">["target"] {
  if (target.type === "uncommittedChanges") {
    return { type: "uncommittedChanges" };
  }
  if (target.type === "baseBranch") {
    if (!target.branch) {
      throw new Error(
        "A base branch is required for a base-branch review",
      );
    }
    return { type: "baseBranch", branch: target.branch };
  }
  if (target.type === "commit") {
    if (!target.sha) {
      throw new Error(
        "A commit SHA is required for a commit review",
      );
    }
    return {
      type: "commit",
      sha: target.sha,
      title: target.title ?? null,
    };
  }
  if (!target.instructions) {
    throw new Error(
      "Instructions are required for a custom review",
    );
  }
  return {
    type: "custom",
    instructions: target.instructions,
  };
}

function mainsContext(
  runId: string,
  execution: RunExecutionContext,
): MainsToolContext {
  return {
    workspaceId: execution.workspaceId,
    rootPath: execution.cwd,
    runId,
  };
}

function reviewPromptEvent(
  request: WorkRunReviewRequest,
): WorkRunEvent {
  const targetLabel =
    request.target.type === "uncommittedChanges"
      ? "Review uncommitted changes"
      : request.target.type === "baseBranch"
        ? `Changes vs ${request.target.branch ?? "base branch"}`
        : request.target.type === "commit"
          ? `Commit ${request.target.sha?.substring(0, 7) ?? ""}${request.target.title ? ` — ${request.target.title}` : ""}`
          : "Code Changes";
  return {
    type: "artifact",
    kind: "user-prompt",
    content: targetLabel,
    metadata: {
      source: "user",
      isReview: true,
      reviewTarget: request.target.type,
      delivery: "inline",
    },
  };
}

/**
 * Owns Codex thread/session acquisition and produces prepared sessions whose
 * turns are executed by the Codex run coordinator.
 */
export function createCodexSessionAcquisition(
  options: CodexSessionAcquisitionOptions,
) {
  const {
    config,
    ensureServer,
    runCoordinator,
    findPersistedSession,
    findPersistedSubAgents,
    persistSession,
    establishGoal,
  } = options;
  const logger =
    options.logger ?? createLogger("[CodexSessionAcquisition]");
  // Read through `config` on every use, never snapshot: the driver refreshes
  // this same object in place when provider settings change
  // (`ProviderDriver.updateConfig`).
  const timeout = () => config.timeout ?? 3_600_000;

  function resolveSessionModel(
    requestedModel: string | undefined,
    responseModel: string | null | undefined,
    operation: "thread/start" | "thread/resume" | "thread/fork",
  ): string | undefined {
    const model = responseModel || requestedModel || undefined;
    if (!model) {
      logger.warn(
        `${operation} returned no model; continuing without an explicit turn model or collaboration-mode pin`,
      );
    }
    return model;
  }

  async function effectiveModel(
    requestedModel: string | null | undefined,
  ): Promise<string | undefined> {
    if (options.resolveModel) {
      const resolved = await options.resolveModel(requestedModel);
      if (resolved) return resolved;
    }
    return (
      requestedModel ||
      config.defaultModel ||
      (await options.resolveDefaultModel?.()) ||
      undefined
    );
  }

  /**
   * Thread settings for one run: the provider config with the run's
   * mode-resolved `configSnapshot` on top. The merge lives here rather than at
   * each call site — create, resume, and fork all need it, and three copies is
   * how `sandbox` ended up re-derived after every spread.
   */
  function threadSettingsFor(overrides: Record<string, unknown> = {}) {
    const sandboxMode =
      typeof overrides.sandboxMode === "string"
        ? (overrides.sandboxMode as CodexAdapterConfig["sandboxMode"])
        : config.sandboxMode;
    const additionalDirectories = Array.isArray(overrides.additionalDirectories)
      ? overrides.additionalDirectories as string[]
      : config.additionalDirectories ?? [];
    return {
      approvalPolicy: config.approvalMode ?? "on-request",
      sandbox: mapSandboxMode(sandboxMode),
      config: buildCodexConfigOverrides(
        config.networkAccessEnabled !== false,
        additionalDirectories,
      ),
    };
  }

  /**
   * Plan / goal for one run: the mode-resolved snapshot over the provider
   * config, same precedence as `threadSettingsFor`. Both flags live on the
   * shared provider row and are toggled from the developer composer, so a
   * Code space that left plan on must not plan a Work or Chat run — and that
   * has to hold on resume and fork too, not just the first turn.
   */
  function runTogglesFor(overrides: Record<string, unknown> = {}) {
    return {
      planMode:
        typeof overrides.planMode === "boolean"
          ? overrides.planMode
          : (config.planMode ?? false),
      goalMode:
        typeof overrides.goalMode === "boolean"
          ? overrides.goalMode
          : (config.goalMode ?? false),
    };
  }

  function turnSettingsFor(overrides: Record<string, unknown> = {}) {
    return {
      effort: typeof overrides.modelReasoningEffort === "string" ? overrides.modelReasoningEffort :
        typeof overrides.effortLevel === "string" ? overrides.effortLevel : config.modelReasoningEffort,
      serviceTier: typeof overrides.serviceTier === "string" ? overrides.serviceTier : config.serviceTier,
    };
  }

  function makeSession(
    runId: string,
    model: string | undefined,
    startTurn: () => Promise<void>,
    preExecuteEvent?: WorkRunEvent,
  ): CodexRunSession {
    return {
      runId,
      startTurn,
      model,
      timeout: timeout(),
      ...(preExecuteEvent ? { preExecuteEvent } : {}),
    };
  }

  async function createSession(
    request: WorkRunRequest,
  ): Promise<AcquiredSession> {
    const { runId } = request;
    let model = await effectiveModel(request.model);
    const server = await ensureServer();
    const overrides = (
      request.configSnapshot ?? {}
    ) as Record<string, unknown>;
    const toggles = runTogglesFor(overrides);
    const settings = threadSettingsFor(overrides);
    const threadStartParams: CodexThreadStartParams = {
      cwd: request.execution.cwd,
      ...settings,
      ...(model ? { model } : {}),
      ...buildDeveloperInstructionsParam(request.extraInstructions),
      dynamicTools: toCodexDynamicTools(request.mode),
    };

    logger.info(
      `Starting thread (model: ${model || "default"}, cwd: ${request.execution.cwd})`,
    );
    const threadResult = await server.sendRequest(
      "thread/start",
      threadStartParams,
    );
    model = resolveSessionModel(model, threadResult.model, "thread/start");
    const threadId = threadResult.thread.id;
    if (threadId) {
      runCoordinator.attachThread(runId, threadId);
    }

    await establishGoal(
      server,
      threadId,
      toggles.goalMode,
      request.goal,
      request.execution.cwd,
      true,
    );
    runCoordinator.registerRun({
      runId,
      threadId: threadId ?? null,
      mainsCtx: mainsContext(runId, request.execution),
    });

    const { effort, serviceTier } = turnSettingsFor(overrides);
    const collaborationMode = buildCollaborationMode(
      toggles.planMode,
      model,
      effort,
    );
    const outputSchema = resolveOutputSchema(config);
    const turnStartParams: CodexTurnStartParams = {
      threadId: threadId ?? "",
      input: buildCodexTurnInput(request.goal, request),
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort: effort || null } : {}),
      ...(serviceTier !== undefined ? { serviceTier: serviceTier || null } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(collaborationMode ? { collaborationMode } : {}),
    };
    const startTurn = async () => {
      await server.sendRequest("turn/start", turnStartParams);
    };
    return {
      session: makeSession(runId, model, startTurn),
      prompt: request.goal,
      sessionId: threadId,
      model,
    };
  }

  async function resumeSession(
    request: WorkRunContinueRequest,
  ): Promise<AcquiredSession> {
    const { runId, message } = request;
    let model = await effectiveModel(request.model);
    const server = await ensureServer();
    let threadId =
      runCoordinator.getSessionThread(runId) ??
      await findPersistedSession(runId);
    if (threadId) {
      runCoordinator.attachThread(runId, threadId);
    }
    if (!threadId) {
      throw new Error(
        `No session found for run ${runId}. Cannot resume.`,
      );
    }

    // Same precedence as createSession: the run's config snapshot beats the
    // provider config, so a resumed chat run keeps its read-only sandbox.
    const resumeOverrides = (
      request.configSnapshot ?? {}
    ) as Record<string, unknown>;
    const settings = threadSettingsFor(resumeOverrides);
    try {
      const resumeResult = await server.sendRequest("thread/resume", {
        threadId,
        excludeTurns: true,
        cwd: request.execution.cwd,
        ...settings,
        ...(model ? { model } : {}),
        ...buildDeveloperInstructionsParam(request.extraInstructions),
      });
      model = resolveSessionModel(
        model,
        resumeResult.model,
        "thread/resume",
      );
    } catch (resumeError) {
      if (isCodexArchivedThreadError(resumeError)) {
        throw normalizeCodexResumeError(resumeError);
      }
      if (!isCodexMissingThreadError(resumeError)) {
        throw resumeError;
      }
      logger.warn(
        `Thread resume failed (${codexErrorMessage(resumeError)}), starting new thread`,
      );
      const threadStartParams: CodexThreadStartParams = {
        cwd: request.execution.cwd,
        ...settings,
        ...(model ? { model } : {}),
        ...buildDeveloperInstructionsParam(request.extraInstructions),
        dynamicTools: toCodexDynamicTools(request.mode),
      };
      const threadResult = await server.sendRequest(
        "thread/start",
        threadStartParams,
      );
      model = resolveSessionModel(
        model,
        threadResult.model,
        "thread/start",
      );
      threadId = threadResult.thread.id;
      runCoordinator.attachThread(runId, threadId);
    }

    const persistedSubAgents =
      !runCoordinator.hasSessionSubAgentState(runId) && findPersistedSubAgents
        ? await findPersistedSubAgents(runId)
        : [];
    runCoordinator.registerRun({
      runId,
      threadId,
      mainsCtx: mainsContext(runId, request.execution),
      subAgents: persistedSubAgents,
    });
    const interruptedSubAgents =
      runCoordinator.getInterruptedSubAgents(runId);
    const currentThreadId =
      runCoordinator.getSessionThread(runId) ?? threadId;
    const resumeToggles = runTogglesFor(resumeOverrides);
    await establishGoal(
      server,
      currentThreadId,
      resumeToggles.goalMode,
      message,
      request.execution.cwd,
      false,
    );

    const { effort, serviceTier } = turnSettingsFor(resumeOverrides);
    const collaborationMode = buildCollaborationMode(
      resumeToggles.planMode,
      model,
      effort,
      true,
    );
    const outputSchema = resolveOutputSchema(config);
    const turnStartParams: CodexTurnStartParams = {
      threadId: currentThreadId,
      input: buildCodexTurnInput(
        message,
        request,
        interruptedSubAgents,
      ),
      ...(request.clientUserMessageId ? { clientUserMessageId: request.clientUserMessageId } : {}),
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort: effort || null } : {}),
      ...(serviceTier !== undefined ? { serviceTier: serviceTier || null } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(collaborationMode ? { collaborationMode } : {}),
    };
    const startTurn = async () => {
      const tracked = request.clientUserMessageId && request.onInputAccepted
        ? runCoordinator.trackInput(runId, request.clientUserMessageId, request.onInputAccepted)
        : undefined;
      try {
        const result = await server.sendRequest("turn/start", turnStartParams);
        await tracked?.accept(result.turn.id);
      } catch (error) {
        if (!tracked?.accepted) throw error;
        await tracked.accept(tracked.turnId!);
      } finally {
        tracked?.finish();
      }
    };
    return {
      session: makeSession(runId, model, startTurn),
      prompt: message,
      sessionId: threadId,
      model,
    };
  }

  async function forkSession(
    request: WorkRunForkRequest,
  ): Promise<AcquiredSession> {
    const { runId, sourceRunId, message } = request;
    let model = await effectiveModel(request.model);
    logger.info(
      `Forking session from run ${sourceRunId} into new run ${runId}`,
    );
    const server = await ensureServer();
    const sourceThreadId =
      runCoordinator.getSessionThread(sourceRunId) ??
      await findPersistedSession(sourceRunId);
    if (!sourceThreadId) {
      throw new Error(
        `No session found for source run ${sourceRunId}. Cannot fork.`,
      );
    }
    runCoordinator.attachThread(sourceRunId, sourceThreadId);

    const forkOverrides = (
      request.configSnapshot ?? {}
    ) as Record<string, unknown>;
    const settings = threadSettingsFor(forkOverrides);
    const forkResult = await server.sendRequest("thread/fork", {
      threadId: sourceThreadId,
      excludeTurns: true,
      cwd: request.execution.cwd,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandbox,
      ...(model ? { model } : {}),
      ...buildDeveloperInstructionsParam(request.extraInstructions),
      config: settings.config,
    });
    model = resolveSessionModel(model, forkResult.model, "thread/fork");
    const forkedThreadId = forkResult.thread.id;
    runCoordinator.attachThread(runId, forkedThreadId);
    const forkToggles = runTogglesFor(forkOverrides);
    await establishGoal(
      server,
      forkedThreadId,
      forkToggles.goalMode,
      message,
      request.execution.cwd,
      false,
    );
    runCoordinator.registerRun({
      runId,
      threadId: forkedThreadId,
      mainsCtx: mainsContext(runId, request.execution),
    });

    const { effort, serviceTier } = turnSettingsFor(forkOverrides);
    const collaborationMode = buildCollaborationMode(
      forkToggles.planMode,
      model,
      effort,
      true,
    );
    const outputSchema = resolveOutputSchema(config);
    const turnStartParams: CodexTurnStartParams = {
      threadId: forkedThreadId,
      input: buildCodexTurnInput(message, request),
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort: effort || null } : {}),
      ...(serviceTier !== undefined ? { serviceTier: serviceTier || null } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(collaborationMode ? { collaborationMode } : {}),
    };
    const startTurn = async () => {
      await server.sendRequest("turn/start", turnStartParams);
    };
    return {
      session: makeSession(runId, model, startTurn),
      prompt: message,
      sessionId: forkedThreadId,
      model,
    };
  }

  async function reviewSession(
    request: WorkRunReviewRequest,
  ): Promise<AcquiredSession> {
    const { runId } = request;
    const target = buildCodexReviewTarget(request.target);
    let model = await effectiveModel(request.model);
    const server = await ensureServer();
    const settings = threadSettingsFor(request.configSnapshot ?? {});
    const threadStartParams: CodexThreadStartParams = {
      cwd: request.execution.cwd,
      ...settings,
      ...(model ? { model } : {}),
      dynamicTools: toCodexDynamicTools(),
    };

    logger.info(
      `Starting review thread (model: ${model || "default"}, cwd: ${request.execution.cwd})`,
    );
    const threadResult = await server.sendRequest(
      "thread/start",
      threadStartParams,
    );
    model = resolveSessionModel(model, threadResult.model, "thread/start");
    const threadId = threadResult.thread.id;
    runCoordinator.registerRun({
      runId,
      threadId: threadId ?? null,
      mainsCtx: mainsContext(runId, request.execution),
    });

    const reviewStartParams:
      CodexAppServerParams<"review/start"> = {
        threadId,
        target,
        delivery: "inline",
      };
    const startTurn = async () => {
      logger.info(
        `Starting review: target=${request.target.type}, delivery=inline`,
      );
      const result = await server.sendRequest(
        "review/start",
        reviewStartParams,
      );
      const reviewThreadId = result.reviewThreadId;
      runCoordinator.attachThread(
        runId,
        reviewThreadId,
        result.turn.id,
      );
      if (reviewThreadId !== threadId) {
        void persistSession(runId, reviewThreadId).catch(
          (error) =>
            logger.warn(
              "Failed to persist unexpected review thread:",
              error instanceof Error
                ? error.message
                : error,
            ),
        );
      }
    };

    return {
      session: makeSession(
        runId,
        model,
        startTurn,
        reviewPromptEvent(request),
      ),
      prompt: "",
      sessionId: threadId,
      model,
    };
  }

  async function prepareRealtimeSession(request: WorkRunRealtimeRequest) {
    let threadId = runCoordinator.getSessionThread(request.runId) ??
      await findPersistedSession(request.runId);
    const server = await ensureServer();
    if (threadId && runCoordinator.hasLiveTurn(request.runId)) {
      if (request.voiceTools) throw new Error("Wait for the current response to finish before starting voice coordination.");
      return { server, threadId, model: request.model, dispose: undefined };
    }
    const bridge = request.voiceTools ? new MainsMcpStdioServer({
      ...mainsContext(request.runId, request.execution), voiceTools: request.voiceTools,
    }, request.mode, { provider: PROVIDER_IDS.codex, scope: "voice" }) : undefined;
    try {
      await bridge?.start();
      let model = await effectiveModel(request.model);
      const overrides = request.configSnapshot ?? {};
      const settings = threadSettingsFor(overrides);
      const turn = turnSettingsFor(overrides);
      const params = {
        cwd: request.execution.cwd, ...settings,
        config: { ...settings.config,
          ...(turn.effort ? { model_reasoning_effort: turn.effort } : {}),
          ...(turn.serviceTier ? { service_tier: turn.serviceTier } : {}),
          ...(bridge ? { "mcp_servers.mains_voice": {
            command: bridge.mcpConfig.command, args: bridge.mcpConfig.args,
            env: Object.fromEntries(bridge.mcpConfig.env.map(({ name, value }) => [name, value])),
            enabled: true, startup_timeout_sec: 10, tool_timeout_sec: 60,
            // These session-local tools call Mains' own scoped run services.
            // Worker permissions and other MCP servers keep their native policies.
            default_tools_approval_mode: "approve",
          } } : {}),
        },
        ...(model ? { model } : {}),
        ...buildDeveloperInstructionsParam(request.extraInstructions),
      };
      if (threadId) {
        try {
          const resumed = await server.sendRequest("thread/resume", { threadId, excludeTurns: true, ...params });
          model = resolveSessionModel(model, resumed.model, "thread/resume");
        } catch (error) { throw normalizeCodexResumeError(error); }
      } else {
        const started = await server.sendRequest("thread/start", { ...params, dynamicTools: toCodexDynamicTools(request.mode) });
        model = resolveSessionModel(model, started.model, "thread/start");
        threadId = started.thread.id;
        if (!threadId) throw new Error("Codex did not create a conversation for voice chat.");
        await persistSession(request.runId, threadId);
      }
      runCoordinator.attachThread(request.runId, threadId);
      runCoordinator.registerRun({
        runId: request.runId, threadId,
        mainsCtx: { workspaceId: request.execution.workspaceId, rootPath: request.execution.cwd, runId: request.runId },
        subAgents: !runCoordinator.hasSessionSubAgentState(request.runId)
          ? await findPersistedSubAgents?.(request.runId)
          : [],
      });
      // Loading voice context must not send a turn or overwrite a tracked goal.
      return { server, threadId, model, dispose: bridge ? () => bridge.stop() : undefined };
    } catch (error) { await bridge?.stop(); throw error; }
  }

  return {
    prepareRealtimeSession,
    createSession,
    forkSession,
    resumeSession,
    reviewSession,
  };
}

export type CodexSessionAcquisition = ReturnType<
  typeof createCodexSessionAcquisition
>;
