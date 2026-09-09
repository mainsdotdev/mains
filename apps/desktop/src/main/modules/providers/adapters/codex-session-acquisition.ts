import type {
  AcquiredSession,
  CodexAdapterConfig,
  FileAttachment,
  RunExecutionContext,
  WorkRunContextItem,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunForkRequest,
  WorkRunRequest,
  WorkRunReviewRequest,
} from "../../../../shared/adapter.types";
import {
  appendPromptSections,
  createLogger,
  formatContextSection,
  saveAttachments,
  type AdapterLogger,
} from "./adapter.shared";
import type { CodexAppServer } from "./codex-app-server.client";
import type { CollaborationMode } from "./codex-app-server-protocol/generated/CollaborationMode";
import type { CodexAppServerParams } from "./codex-app-server-protocol/rpc";
import type { MainsToolContext } from "./mains-tools.core";
import { toCodexDynamicTools } from "./mains-tools.registry";
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
type TurnInput = CodexAppServerParams<"turn/start">["input"];

interface TurnInputRequest {
  runId: string;
  context?: WorkRunContextItem[];
  contextIssues?: WorkRunRequest["contextIssues"];
  contextSignals?: WorkRunRequest["contextSignals"];
  contextFiles?: WorkRunRequest["contextFiles"];
  skills?: WorkRunRequest["skills"];
  attachments?: FileAttachment[];
}

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

function isCodexMissingThreadError(error: unknown): boolean {
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
): CodexConfigOverrides {
  return {
    sandbox_workspace_write: {
      network_access: networkAccess,
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
        effort ?? (planEnabled ? "medium" : null),
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

function buildTurnInput(
  message: string,
  request: TurnInputRequest,
  interruptedSubAgents: CodexSubAgentRunMeta[] = [],
): TurnInput {
  let prompt =
    request.context && request.context.length > 0
      ? `Context:\n${formatContextSection(request.context)}\n\n---\n\n ${message}`
      : message;

  prompt = appendPromptSections(prompt, {
    contextIssues: request.contextIssues,
    contextSignals: request.contextSignals,
    contextFiles: request.contextFiles,
    runId: request.runId,
  });

  if (interruptedSubAgents.length > 0) {
    const agents = interruptedSubAgents.map((agent) => ({
      id: agent.threadId,
      ...(agent.nickname ? { name: agent.nickname } : {}),
      ...(agent.role ? { role: agent.role } : {}),
    }));
    prompt +=
      "\n\n<mains_interrupted_subagents>\n" +
      "The previous turn was stopped, so these subagents are interrupted and are not making progress:\n" +
      `${JSON.stringify(agents)}\n` +
      "If the user's current request still depends on their work, do not call wait_agent on them yet. " +
      "First call resume_agent for each interrupted id, then call send_input asking it to continue its previously assigned task. " +
      "If an agent cannot be resumed, spawn a replacement for that task. " +
      "If the current request no longer depends on them, continue without waiting for them.\n" +
      "</mains_interrupted_subagents>";
  }

  const input: TurnInput = [{
    type: "text",
    text: prompt,
    text_elements: [],
  }];

  for (const skill of request.skills ?? []) {
    if (skill.name && skill.path) {
      input.push({
        type: "skill",
        name: skill.name,
        path: skill.path,
      });
    }
  }

  if (request.attachments && request.attachments.length > 0) {
    const { savedPaths, inlineTexts } = saveAttachments(
      request.attachments,
      request.runId,
    );
    if (inlineTexts.length > 0 && input[0].type === "text") {
      input[0].text =
        `${prompt}\n\n---\n\nAttached documents:\n` +
        inlineTexts.join("\n\n");
    }

    for (const attachmentPath of savedPaths) {
      const lowerPath = attachmentPath.toLowerCase();
      if (
        lowerPath.endsWith(".png") ||
        lowerPath.endsWith(".jpg") ||
        lowerPath.endsWith(".jpeg") ||
        lowerPath.endsWith(".gif") ||
        lowerPath.endsWith(".webp") ||
        lowerPath.endsWith(".bmp")
      ) {
        input.push({
          type: "localImage",
          path: attachmentPath,
        });
      }
    }
  }

  return input;
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
      delivery: request.delivery ?? "inline",
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
    // Codex's own tone lever: work/chat pin it through the mode harness, and
    // developer leaves it to the provider setting.
    const personality =
      typeof overrides.personality === "string"
        ? (overrides.personality as CodexAdapterConfig["personality"])
        : config.personality;
    return {
      approvalPolicy: config.approvalMode ?? "on-request",
      sandbox: mapSandboxMode(sandboxMode),
      personality: personality ?? "none",
      config: buildCodexConfigOverrides(
        config.networkAccessEnabled !== false,
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
    const overrideEffort =
      typeof overrides.modelReasoningEffort === "string"
        ? overrides.modelReasoningEffort
        : typeof overrides.effortLevel === "string" &&
            overrides.effortLevel
          ? overrides.effortLevel
          : undefined;
    const overrideServiceTier =
      typeof overrides.serviceTier === "string" &&
      overrides.serviceTier
        ? overrides.serviceTier
        : undefined;
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

    const effort =
      overrideEffort ?? config.modelReasoningEffort;
    const serviceTier =
      overrideServiceTier ?? config.serviceTier;
    const collaborationMode = buildCollaborationMode(
      toggles.planMode,
      model,
      effort,
    );
    const outputSchema = resolveOutputSchema(config);
    const turnStartParams: CodexTurnStartParams = {
      threadId: threadId ?? "",
      input: buildTurnInput(request.goal, request),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(serviceTier ? { serviceTier } : {}),
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

    const collaborationMode = buildCollaborationMode(
      resumeToggles.planMode,
      model,
      config.modelReasoningEffort,
      true,
    );
    const outputSchema = resolveOutputSchema(config);
    const turnStartParams: CodexTurnStartParams = {
      threadId: currentThreadId,
      input: buildTurnInput(
        message,
        request,
        interruptedSubAgents,
      ),
      ...(model ? { model } : {}),
      ...(config.modelReasoningEffort
        ? { effort: config.modelReasoningEffort }
        : {}),
      ...(config.serviceTier
        ? { serviceTier: config.serviceTier }
        : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(collaborationMode ? { collaborationMode } : {}),
    };
    const startTurn = async () => {
      await server.sendRequest("turn/start", turnStartParams);
    };
    return {
      session: makeSession(runId, model, startTurn),
      prompt: message,
      sessionId: threadId,
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
    // `thread/fork` has no `personality` field — the forked thread inherits the
    // source's — so only the fields the contract names are passed through.
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

    const collaborationMode = buildCollaborationMode(
      forkToggles.planMode,
      model,
      config.modelReasoningEffort,
      true,
    );
    const outputSchema = resolveOutputSchema(config);
    const turnStartParams: CodexTurnStartParams = {
      threadId: forkedThreadId,
      input: buildTurnInput(message, request),
      ...(model ? { model } : {}),
      ...(config.modelReasoningEffort
        ? { effort: config.modelReasoningEffort }
        : {}),
      ...(config.serviceTier
        ? { serviceTier: config.serviceTier }
        : {}),
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
    };
  }

  async function reviewSession(
    request: WorkRunReviewRequest,
  ): Promise<AcquiredSession> {
    const { runId } = request;
    const target = buildCodexReviewTarget(request.target);
    let model = await effectiveModel(request.model);
    const server = await ensureServer();
    const settings = threadSettingsFor();
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
        ...(request.delivery
          ? { delivery: request.delivery }
          : {}),
      };
    const startTurn = async () => {
      logger.info(
        `Starting review: target=${request.target.type}, delivery=${request.delivery ?? "inline"}`,
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
              "Failed to persist detached review thread:",
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
    };
  }

  return {
    createSession,
    forkSession,
    resumeSession,
    reviewSession,
  };
}

export type CodexSessionAcquisition = ReturnType<
  typeof createCodexSessionAcquisition
>;
