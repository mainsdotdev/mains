import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { CHANNELS } from "@mains/contracts/channels";
import { emit } from "../../../../ipc-kit";
import { getBackendRuntime } from "../../../../runtime/backend-runtime";
import { runsRepo } from "../../../runs/runs.repo";
import { requestToolApproval } from "../../../runs/user-input-broker";
import type { ModeId } from "@mains/contracts/modes";
import type {
  AcquiredSession,
  AccountInfo,
  CliUpdateResult,
  CommandInfo,
  DriverOutcome,
  ModelInfo,
  OpenCodeAdapterConfig,
  ProviderDriver,
  WorkRunContinueRequest,
  WorkRunEventHandler,
  WorkRunForkRequest,
  WorkRunRequest,
} from "../../../../../shared/adapter.types";
import type { MainsToolContext } from "../mains-tools.core";
import { MainsMcpStdioServer } from "../mains-mcp-server";
import {
  adoptConfig,
  appendPromptSections,
  attachmentPromptParts,
  createLogger,
  formatContextSection,
  resolveCatalogDefaultId,
} from "../adapter.shared";
import { findOpenCodeBinaryPath, providerProcessPath } from "../../providers.utils";
import { spawnProvider as spawn } from "../provider-process";
import { OpenCodeAcpServer } from "./opencode-acp";
import { decideOpenCodeForm, openCodeFormRequest } from "./opencode-elicitation";
import {
  MINIMUM_OPENCODE_VERSION,
  commandsFromUpdate,
  currentModelIdFromConfigOptions,
  effortLevelsFromConfigOptions,
  finishOpenCodeTurn,
  mapStopReasonToOutcome,
  modelsFromConfigOptions,
  openCodeCliCompatibility,
  parseOpenCodeAuthList,
  openCodeSessionTitle,
  parseOpenCodeVersion,
  projectSessionUpdate,
  selectPermissionOption,
  titleFromSessionList,
  type AcpConfigOption,
  type AcpPermissionOption,
  type OpenCodeTurnProjection,
} from "./opencode-events";

const log = createLogger("[OpenCode]");

interface OpenCodeSession {
  runId: string;
  sessionId: string;
  cwd: string;
  acp: OpenCodeAcpServer;
  mcp: MainsMcpStdioServer;
  /** Assistant-only ACP context keeps slash commands in the user text intact. */
  promptContext?: string;
  projection: OpenCodeTurnProjection;
}

type OpenCodeRunRuntime = Pick<OpenCodeSession, "acp" | "mcp">;

interface ActivePrompt {
  onNotification(method: string, params: unknown): void;
  onRequest(id: number | string, method: string, params: unknown): void;
}

function absoluteCwd(cwd: string | null | undefined): string {
  if (!cwd) throw new Error("OpenCode needs an absolute working directory");
  return path.resolve(cwd);
}

/** Same cut as the run service's first-line fallback, so a generated title can replace it. */
function promptFallbackTitle(goal: string): string {
  const firstLine = goal.split("\n")[0]?.trim() ?? "";
  if (firstLine.length <= 60) return firstLine;
  const truncated = firstLine.substring(0, 60);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + "...";
}

/**
 * Write OpenCode's session title onto the run. A title the user already
 * replaced is left alone; the prompt fallback and OpenCode's placeholder are not.
 */
async function adoptOpenCodeTitle(runId: string, title: string): Promise<void> {
  const run = await runsRepo.findRunById(runId);
  if (!run || run.title === title) return;
  const current = run.title?.trim() ?? "";
  const fallback = run.goal ? promptFallbackTitle(run.goal) : "";
  if (current && current !== fallback && openCodeSessionTitle(current)) return;
  await runsRepo.updateRun(runId, { title });
  emit("runs:updated", { runId, ts: Date.now() });
}

async function readOpenCodeTitle(acp: OpenCodeAcpServer, session: { runId: string; sessionId: string; cwd: string }): Promise<void> {
  if (!acp.isRunning) return;
  try {
    const listed = await acp.sendRequest("session/list", { cwd: session.cwd }, 15_000);
    const title = titleFromSessionList(listed, session.sessionId);
    if (title) await adoptOpenCodeTitle(session.runId, title);
  } catch (error) {
    log.warn("OpenCode session title was not read:", error);
  }
}

function sessionUpdateOf(params: unknown): Record<string, unknown> | null {
  const update = (params as { update?: unknown } | null)?.update;
  return update && typeof update === "object" ? update as Record<string, unknown> : null;
}

function promptText(
  base: string,
  extra: {
    extraInstructions?: string | null;
    cwd?: string;
    context?: WorkRunRequest["context"];
    contextIssues?: WorkRunRequest["contextIssues"];
    contextSignals?: WorkRunRequest["contextSignals"];
    contextFiles?: WorkRunRequest["contextFiles"];
    attachments?: WorkRunRequest["attachments"];
    runId: string;
  },
): string {
  const prefix = extra.extraInstructions
    ? `<mode_instructions>\n${extra.extraInstructions}\n</mode_instructions>\n\n`
    : "";
  const directory = extra.cwd ? `Working directory: ${extra.cwd}\n\n` : "";
  const context = extra.context && extra.context.length > 0
    ? `Context:\n${formatContextSection(extra.context)}\n\n---\n\n`
    : "";
  let prompt = `${prefix}${directory}${context}${base}`;
  prompt = appendPromptSections(prompt, {
    contextIssues: extra.contextIssues,
    contextSignals: extra.contextSignals,
    contextFiles: extra.contextFiles,
    runId: extra.runId,
  });
  if (extra.attachments && extra.attachments.length > 0) {
    const { savedPaths, inlineTexts } = attachmentPromptParts(extra.attachments);
    if (inlineTexts.length > 0) prompt = `${prompt}\n\n---\n\nAttached documents:\n${inlineTexts.join("\n\n")}`;
    if (savedPaths.length > 0) prompt = `${prompt}\n\n---\n\nAttached files:\n${savedPaths.map((file) => `- ${file}`).join("\n")}`;
  }
  return prompt;
}

export function createOpenCodeDriver(initial: OpenCodeAdapterConfig = {}): ProviderDriver {
  const config = { ...initial };
  let server: OpenCodeAcpServer | null = null;
  let starting: Promise<OpenCodeAcpServer> | null = null;
  let closed = false;
  let versionText = "";
  const sessions = new Map<string, string>();
  const runRuntimes = new Map<string, OpenCodeRunRuntime>();
  const textGenerationCleanups = new Set<() => Promise<void>>();
  const activePrompts = new Map<string, ActivePrompt>();
  const commandsByCwd = new Map<string, CommandInfo[]>();
  let models: ModelInfo[] | null = null;
  let catalogGeneration = 0;
  let effortProbe: Promise<void> | null = null;
  const effortCache = new Map<string, string[]>();
  const EFFORT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  let catalogListener: ((method: string, params: unknown) => void) | null = null;

  function rememberCommands(cwd: string, update: Record<string, unknown>): void {
    if (update.sessionUpdate !== "available_commands_update") return;
    const commands = commandsFromUpdate(update);
    if (commands.length > 0) commandsByCwd.set(cwd, commands);
  }

  async function runBinary(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const binaryPath = requireBinary();
    return new Promise((resolve) => {
      const child = spawn(binaryPath, args, {
        env: { ...process.env, HOME: os.homedir(), PATH: providerProcessPath(binaryPath) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);
      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: `${stderr}${error.message}`, code: null });
      });
    });
  }

  function requireBinary(): string {
    const configured = config.binary?.trim();
    const binary = configured || findOpenCodeBinaryPath();
    if (!binary) throw new Error("OpenCode CLI was not found. Install OpenCode 2 and restart Mains.");
    return binary;
  }

  async function assertSupportedCli(): Promise<string> {
    if (versionText && openCodeCliCompatibility(versionText) === "supported") return versionText;
    const result = await runBinary(["--version"], 10_000);
    versionText = `${result.stdout}\n${result.stderr}`;
    const parsed = parseOpenCodeVersion(versionText);
    if (!parsed) throw new Error("Could not read the OpenCode version. Mains requires OpenCode 2.");
    if (parsed.major < 2) {
      throw new Error(`OpenCode ${parsed.version} is too old. Mains requires OpenCode ${MINIMUM_OPENCODE_VERSION} or newer.`);
    }
    return versionText;
  }

  async function initializeServer(next: OpenCodeAcpServer): Promise<void> {
    try {
      await assertSupportedCli();
      if (closed) throw new Error("OpenCode driver is shut down");
      const binaryPath = requireBinary();
      await next.start(binaryPath, { HOME: os.homedir(), PATH: providerProcessPath(binaryPath) });
      const initialized = await next.sendRequest("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "mains", title: "Mains", version: "1.0.0" },
        clientCapabilities: { elicitation: { form: {} } },
      }) as { authMethods?: Array<{ id?: string; type?: string }> };
      next.sendNotification("initialized");
      const method = initialized.authMethods?.find((entry) => entry.type !== "terminal" && entry.id);
      if (method?.id) {
        await next.sendRequest("authenticate", { methodId: method.id }).catch((error) => {
          log.warn("OpenCode authenticate did not complete:", error);
        });
      }
      next.setNotificationHandler((method, params) => {
        catalogListener?.(method, params);
        const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
        const owner = typeof sessionId === "string" ? activePrompts.get(sessionId) : undefined;
        owner?.onNotification(method, params);
      });
      next.setRequestHandler((id, method, params) => {
        const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
        const owner = typeof sessionId === "string" ? activePrompts.get(sessionId) : undefined;
        if (owner) owner.onRequest(id, method, params);
        else if (method === "elicitation/create") next.respond(id, { action: "cancel" });
        else next.respondError(id, -32000, "No active OpenCode session for this request");
      });
    } catch (error) {
      await next.stop();
      throw error;
    }
  }

  /** Discovery never receives a run's MCP bridge. OpenCode shares MCP by cwd. */
  async function ensureServer(): Promise<OpenCodeAcpServer> {
    if (starting) return starting;
    if (server?.isRunning) return server;
    const next = new OpenCodeAcpServer();
    server = next;
    next.setOnClose(() => {
      if (server === next) server = null;
    });
    starting = initializeServer(next).then(() => next);
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  async function stopRuntime(runtime: OpenCodeRunRuntime): Promise<void> {
    try {
      await runtime.acp.stop();
    } finally {
      await runtime.mcp.stop();
    }
  }

  async function withMcp(
    request: { runId: string; execution: { workspaceId: string | null; cwd: string | null }; mode?: ModeId },
    acquire: (mcp: MainsMcpStdioServer, acp: OpenCodeAcpServer) => Promise<AcquiredSession>,
  ): Promise<AcquiredSession> {
    if (closed) throw new Error("OpenCode driver is shut down");
    const previous = runRuntimes.get(request.runId);
    if (previous) await stopRuntime(previous);
    runRuntimes.delete(request.runId);
    const ctx: MainsToolContext = {
      workspaceId: request.execution.workspaceId,
      rootPath: request.execution.cwd,
      runId: request.runId,
    };
    const mcp = new MainsMcpStdioServer(ctx, request.mode, { provider: PROVIDER_IDS.opencode });
    // Unique names alone cannot isolate bridges: all sessions in one ACP
    // process can see every MCP server registered for the same directory.
    const runtime = { mcp, acp: new OpenCodeAcpServer() };
    runRuntimes.set(request.runId, runtime);
    try {
      await mcp.start();
      await initializeServer(runtime.acp);
      return await acquire(mcp, runtime.acp);
    } catch (error) {
      await stopRuntime(runtime).catch(() => {});
      if (runRuntimes.get(request.runId) === runtime) runRuntimes.delete(request.runId);
      throw error;
    }
  }

  function selectedAgent(snapshot: Record<string, unknown> | null | undefined): string {
    const fromRun = snapshot?.agent;
    if (typeof fromRun === "string" && fromRun) return fromRun;
    return config.agent || "build";
  }

  function selectedEffort(snapshot: Record<string, unknown> | null | undefined): string | undefined {
    const fromRun = snapshot?.effortLevel;
    if (typeof fromRun === "string") return fromRun || undefined;
    return config.effortLevel || undefined;
  }

  async function applySelection(
    acp: OpenCodeAcpServer,
    sessionId: string,
    model: string | undefined,
    agent: string,
    effort: string | undefined,
  ): Promise<void> {
    if (model) {
      await acp.sendRequest("session/set_config_option", { sessionId, configId: "model", value: model });
    }
    if (effort) {
      await acp.sendRequest("session/set_config_option", { sessionId, configId: "effort", value: effort }).catch((error) => {
        log.warn(`OpenCode effort "${effort}" was not applied:`, error);
      });
    }
    await acp.sendRequest("session/set_config_option", { sessionId, configId: "mode", value: agent }).catch((error) => {
      log.warn(`OpenCode agent "${agent}" was not applied:`, error);
    });
  }

  async function openNativeSession(
    acp: OpenCodeAcpServer,
    method: "session/new" | "session/resume" | "session/fork",
    cwd: string,
    mcpServers: unknown[],
    sessionId?: string,
    waitForCommands = false,
  ): Promise<{ sessionId: string; configOptions?: AcpConfigOption[] }> {
    const commands: CommandInfo[] = [];
    let sawCommands = false;
    catalogListener = (_method, params) => {
      const update = sessionUpdateOf(params);
      if (!update) return;
      const next = commandsFromUpdate(update);
      if (next.length === 0) return;
      sawCommands = true;
      commands.splice(0, commands.length, ...next);
    };
    try {
      const result = await acp.sendRequest(method, {
        cwd,
        ...(sessionId ? { sessionId } : {}),
        mcpServers,
      }) as { sessionId?: string; configOptions?: AcpConfigOption[] };
      if (waitForCommands && !sawCommands) await new Promise((resolve) => setTimeout(resolve, 400));
      if (commands.length > 0) commandsByCwd.set(cwd, commands);
      const id = result.sessionId || sessionId;
      if (!id) throw new Error(`OpenCode did not return a session id from ${method}`);
      return { sessionId: id, configOptions: result.configOptions };
    } finally {
      catalogListener = null;
    }
  }

  function projectionFor(runId: string): OpenCodeTurnProjection {
    return {
      runId,
      text: "",
      thought: "",
      generation: 0,
      streamPrefix: `opencode-msg-${runId}-${randomUUID()}`,
      tools: new Map(),
    };
  }

  function bindPrompt(acp: OpenCodeAcpServer, session: OpenCodeSession, onEvent: WorkRunEventHandler): { idle: () => Promise<void> } {
    let chain = Promise.resolve();
    const emit = (event: Parameters<WorkRunEventHandler>[0]) => {
      chain = chain.then(() => Promise.resolve(onEvent(event))).catch((error) => {
        log.error("Failed to project OpenCode event:", error);
      });
    };
    activePrompts.set(session.sessionId, {
      onNotification(method, params) {
        if (method !== "session/update") return;
        const update = sessionUpdateOf(params);
        if (!update) return;
        rememberCommands(session.cwd, update);
        const title = update.sessionUpdate === "session_info_update"
          ? openCodeSessionTitle(update.title)
          : null;
        if (title) chain = chain.then(() => adoptOpenCodeTitle(session.runId, title));
        for (const event of projectSessionUpdate(session.projection, update)) emit(event);
      },
      onRequest(id, method, params) {
        void answerRequest(acp, session, id, method, params);
      },
    });
    return { idle: () => chain };
  }

  async function answerRequest(
    acp: OpenCodeAcpServer,
    session: OpenCodeSession,
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<void> {
    // JSON-RPC request ids are local to each run's ACP process.
    const requestId = `opencode-${session.runId}-${id}`;
    if (method === "elicitation/create") {
      const form = openCodeFormRequest(params);
      if (!form) {
        acp.respond(id, { action: "cancel" });
        return;
      }
      try {
        const result = await requestToolApproval({
          requestId,
          runId: session.runId,
          toolName: form.message,
          kind: "elicitation",
          header: "OpenCode",
          question: form.message,
          serverName: "OpenCode",
          elicitationMode: "form",
          requestedSchema: form.schema,
          timestamp: Date.now(),
        });
        if (acp.isRunning) acp.respond(id, decideOpenCodeForm(form.schema, result));
      } catch {
        if (acp.isRunning) acp.respond(id, { action: "cancel" });
      }
      return;
    }
    if (method !== "session/request_permission") {
      acp.respondError(id, -32601, `Unhandled OpenCode request ${method}`);
      return;
    }
    const body = params as { options?: AcpPermissionOption[]; toolCall?: Record<string, unknown> } | null;
    const options = body?.options;
    const toolCall = body?.toolCall ?? {};
    // An explicit native ask requires a user decision, including for Mains
    // tools. Presentation titles can contain arbitrary names or shell input.
    const title = typeof toolCall.title === "string" ? toolCall.title : "OpenCode";
    const rawInput = toolCall.rawInput;
    try {
      const result = await requestToolApproval({
        requestId,
        runId: session.runId,
        toolName: title,
        toolInput: rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
          ? rawInput as Record<string, unknown>
          : undefined,
        kind: "tool_approval",
        timestamp: Date.now(),
      });
      const decision = !result.approved
        ? "reject_once"
        : result.answer === "acceptForSession" ? "allow_always" : "allow_once";
      if (acp.isRunning) acp.respond(id, { outcome: { outcome: "selected", optionId: selectPermissionOption(options, decision) } });
    } catch {
      if (acp.isRunning) acp.respond(id, { outcome: { outcome: "cancelled" } });
    }
  }

  function effortCacheFile(): string {
    return path.join(getBackendRuntime().getPath("userData"), "opencode-model-effort.json");
  }

  function loadEffortCache(): void {
    if (effortCache.size > 0) return;
    try {
      const data = JSON.parse(fs.readFileSync(effortCacheFile(), "utf8")) as { ts?: number; models?: Record<string, string[]> };
      if (!data?.models || (data.ts && Date.now() - data.ts > EFFORT_CACHE_TTL_MS)) return;
      for (const [id, levels] of Object.entries(data.models)) {
        if (Array.isArray(levels)) effortCache.set(id, levels.filter((level) => typeof level === "string" && level !== "default"));
      }
    } catch {
      /* first launch, or the runtime has no user-data path */
    }
  }

  function saveEffortCache(): void {
    try {
      const stored: Record<string, string[]> = {};
      for (const [id, levels] of effortCache) stored[id] = levels;
      fs.writeFileSync(effortCacheFile(), JSON.stringify({ ts: Date.now(), models: stored }), "utf8");
    } catch {
      /* the catalog still works without a persisted cache */
    }
  }

  function rememberEffort(options: AcpConfigOption[] | undefined, modelId?: string): void {
    const id = modelId ?? currentModelIdFromConfigOptions(options);
    if (!id) return;
    effortCache.set(id, effortLevelsFromConfigOptions(options));
  }

  function withEffort(model: ModelInfo): ModelInfo {
    const levels = effortCache.get(model.id);
    if (!levels || levels.length === 0) return model;
    return { ...model, supportsEffort: true, supportedEffortLevels: levels };
  }

  function publishModels(): void {
    try {
      emit(CHANNELS.providers.modelsUpdated, { providerId: PROVIDER_IDS.opencode });
    } catch {
      /* tests and non-main callers have no event sink */
    }
  }

  /**
   * ACP reports variants only for the model that is selected. Walk the rest on
   * a throwaway session of the shared process — the option is per session, so
   * a running chat is left on its own model.
   */
  function probeEffort(modelIds: string[], generation: number): void {
    const missing = modelIds.filter((id) => !effortCache.has(id));
    if (missing.length === 0 || effortProbe) return;
    effortProbe = (async () => {
      const acp = await ensureServer();
      const opened = await acp.sendRequest("session/new", { cwd: os.homedir(), mcpServers: [] }) as { sessionId?: string };
      const sessionId = opened.sessionId;
      if (!sessionId) return;
      try {
        for (const id of missing) {
          try {
            const result = await acp.sendRequest("session/set_config_option", {
              sessionId,
              configId: "model",
              value: id,
            }, 15_000) as { configOptions?: AcpConfigOption[] };
            rememberEffort(result.configOptions, id);
          } catch (error) {
            log.warn(`OpenCode effort for "${id}" was not read:`, error);
          }
        }
      } finally {
        await openedAndDiscard(acp, sessionId, os.homedir());
      }
      saveEffortCache();
      const gained = missing.some((id) => (effortCache.get(id)?.length ?? 0) > 0);
      if (!gained || generation !== catalogGeneration || !models) return;
      models = models.map(withEffort);
      publishModels();
    })().catch((error) => {
      log.warn("OpenCode effort probe failed:", error);
    }).finally(() => {
      effortProbe = null;
    });
  }

  async function catalog(cwd: string): Promise<{ models: ModelInfo[]; commands: CommandInfo[] }> {
      const acp = await ensureServer();
      const opened = await openNativeSession(acp, "session/new", cwd, [], undefined, true);
      try {
        rememberEffort(opened.configOptions);
        return {
          models: modelsFromConfigOptions(opened.configOptions, config.defaultModel),
          commands: commandsByCwd.get(cwd) ?? [],
        };
      } finally {
        await openedAndDiscard(acp, opened.sessionId, cwd);
      }
  }

  async function openedAndDiscard(acp: OpenCodeAcpServer, sessionId: string, cwd: string): Promise<void> {
    await acp.sendRequest("session/delete", { sessionId, cwd }).catch(() =>
      acp.sendRequest("session/close", { sessionId }).catch(() => {}),
    );
  }

  return {
    async generateText(prompt, opts): Promise<string> {
      if (closed) throw new Error("OpenCode driver is shut down");
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mains-opencode-gen-"));
      const acp = new OpenCodeAcpServer();
      const projection = projectionFor("generateText");
      let sessionId: string | undefined;
      let disposing: Promise<void> | undefined;
      const dispose = () => disposing ??= (async () => {
        try {
          if (sessionId && acp.isRunning) {
            await acp.sendRequest("session/delete", { sessionId, cwd }, 3000).catch((error) => {
              log.warn("Could not delete the OpenCode text generation session:", error);
            });
          }
        } finally {
          try {
            await acp.stop();
          } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
          }
        }
      })();
      textGenerationCleanups.add(dispose);
      try {
        await initializeServer(acp);
        acp.setNotificationHandler((method, params) => {
          if (method !== "session/update" || (params as { sessionId?: unknown } | null)?.sessionId !== sessionId) return;
          const update = sessionUpdateOf(params);
          if (!update || (update._meta as Record<string, unknown> | undefined)?.["opencode/child-session"]) return;
          projectSessionUpdate(projection, update);
        });
        // Background generation has no interactive approval surface.
        acp.setRequestHandler((id, method) => {
          if (method === "session/request_permission") acp.respond(id, { outcome: { outcome: "cancelled" } });
          else if (method === "elicitation/create") acp.respond(id, { action: "cancel" });
          else acp.respondError(id, -32601, `Unhandled OpenCode request ${method}`);
        });
        const opened = await acp.sendRequest("session/new", { cwd, mcpServers: [] }) as { sessionId?: string };
        sessionId = opened.sessionId;
        if (!sessionId) throw new Error("OpenCode did not return a text generation session id");
        const model = opts?.model || config.defaultModel;
        if (model) await acp.sendRequest("session/set_config_option", { sessionId, configId: "model", value: model });
        // Fail if Plan cannot be selected; generation must not inherit Build.
        await acp.sendRequest("session/set_config_option", { sessionId, configId: "mode", value: "plan" });
        const instruction = [opts?.system, "Generate only the requested text from the supplied context. Do not use tools or ask questions."].filter(Boolean).join("\n\n");
        const result = await acp.sendRequest("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: `${instruction}\n\n${prompt}` }],
        }, Math.min(config.timeout ?? 30_000, 30_000)) as { stopReason?: string };
        if (result.stopReason !== "end_turn") {
          throw new Error(result.stopReason === "refusal" ? "OpenCode refused the request"
            : result.stopReason === "cancelled" ? "OpenCode text generation was canceled"
            : "OpenCode text generation ended before the response was complete");
        }
        const text = projection.text.trim();
        if (!text) throw new Error("OpenCode generated an empty response");
        return text;
      } finally {
        try {
          await dispose();
        } finally {
          textGenerationCleanups.delete(dispose);
        }
      }
    },

    async createSession(request): Promise<AcquiredSession> {
      const cwd = absoluteCwd(request.execution.cwd);
      return withMcp(request, async (mcp, acp) => {
        const opened = await openNativeSession(acp, "session/new", cwd, [mcp.mcpConfig]);
        const model = request.model || config.defaultModel;
        await applySelection(acp, opened.sessionId, model, selectedAgent(request.configSnapshot), selectedEffort(request.configSnapshot));
        sessions.set(request.runId, opened.sessionId);
        if (opened.configOptions) {
          models = modelsFromConfigOptions(opened.configOptions, config.defaultModel);
        }
        const session: OpenCodeSession = {
          runId: request.runId,
          sessionId: opened.sessionId,
          cwd,
          acp,
          mcp,
          projection: projectionFor(request.runId),
        };
        return {
          session,
          sessionId: opened.sessionId,
          model,
          prompt: promptText(request.goal, {
            extraInstructions: request.extraInstructions,
            cwd,
            context: request.context,
            contextIssues: request.contextIssues,
            contextSignals: request.contextSignals,
            contextFiles: request.contextFiles,
            attachments: request.attachments,
            runId: request.runId,
          }),
        };
      });
    },

    async resumeSession(request: WorkRunContinueRequest): Promise<AcquiredSession> {
      const cwd = absoluteCwd(request.execution.cwd);
      return withMcp(request, async (mcp, acp) => {
        let sessionId = sessions.get(request.runId);
        if (!sessionId) {
          const run = await runsRepo.findRunById(request.runId);
          if (run?.sessionId) sessionId = run.sessionId;
        }
        if (!sessionId) throw new Error(`No OpenCode session is stored for run ${request.runId}`);
        let opened: { sessionId: string };
        try {
          opened = await openNativeSession(acp, "session/resume", cwd, [mcp.mcpConfig], sessionId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/\bsession\b[^\n]*(?:not found|does not exist)|\bunknown session\b/i.test(message)) {
            throw Object.assign(new Error("The OpenCode session is no longer available. Your chat history is still saved in Mains. Start a new chat to continue."), { cause: error });
          }
          throw error;
        }
        const model = request.model || config.defaultModel;
        await applySelection(acp, opened.sessionId, model, selectedAgent(request.configSnapshot), selectedEffort(request.configSnapshot));
        sessions.set(request.runId, opened.sessionId);
        const session: OpenCodeSession = {
          runId: request.runId,
          sessionId: opened.sessionId,
          cwd,
          acp,
          mcp,
          promptContext: promptText("", {
            extraInstructions: request.extraInstructions,
            cwd,
            context: request.context,
            contextIssues: request.contextIssues,
            contextSignals: request.contextSignals,
            contextFiles: request.contextFiles,
            attachments: request.attachments,
            runId: request.runId,
          }),
          projection: projectionFor(request.runId),
        };
        return {
          session,
          sessionId: opened.sessionId,
          model,
          prompt: request.message,
        };
      });
    },

    async forkSession(request: WorkRunForkRequest): Promise<AcquiredSession> {
      const cwd = absoluteCwd(request.execution.cwd);
      return withMcp(request, async (mcp, acp) => {
        const sourceId = sessions.get(request.sourceRunId)
          || (await runsRepo.findRunById(request.sourceRunId))?.sessionId;
        if (!sourceId) throw new Error(`No OpenCode session is stored for run ${request.sourceRunId}`);
        const opened = await openNativeSession(acp, "session/fork", cwd, [mcp.mcpConfig], sourceId);
        const model = request.model || config.defaultModel;
        await applySelection(acp, opened.sessionId, model, selectedAgent(request.configSnapshot), selectedEffort(request.configSnapshot));
        sessions.set(request.runId, opened.sessionId);
        const session: OpenCodeSession = {
          runId: request.runId,
          sessionId: opened.sessionId,
          cwd,
          acp,
          mcp,
          projection: projectionFor(request.runId),
        };
        return {
          session,
          sessionId: opened.sessionId,
          model,
          prompt: promptText(request.message, {
            extraInstructions: request.extraInstructions,
            cwd,
            context: request.context,
            attachments: request.attachments,
            runId: request.runId,
          }),
        };
      });
    },

    async executePrompt(session, prompt, onEvent, signal): Promise<DriverOutcome> {
      const current = session as OpenCodeSession;
      if (signal.aborted) return { status: "canceled" };
      const acp = current.acp;
      if (!acp.isRunning) return { status: "failed", summary: "OpenCode ACP is not running" };
      if (activePrompts.has(current.sessionId)) {
        return { status: "failed", summary: "OpenCode session already has an active prompt" };
      }
      current.mcp.setEventHandler(onEvent);
      const delivery = bindPrompt(acp, current, onEvent);
      const cancel = () => {
        if (acp.isRunning) acp.sendNotification("session/cancel", { sessionId: current.sessionId });
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await acp.sendRequest("session/prompt", {
          sessionId: current.sessionId,
          prompt: [
            { type: "text", text: prompt },
            ...(current.promptContext ? [{
              type: "text", text: current.promptContext,
              annotations: { audience: ["assistant"] },
            }] : []),
          ],
        }, config.timeout ?? 3_600_000) as {
          stopReason?: string;
          usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        };
        await delivery.idle();
        await readOpenCodeTitle(acp, current);
        const outcome = {
          ...mapStopReasonToOutcome(result.stopReason),
          stopReason: result.stopReason,
          ...(result.usage ? {
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            },
          } : {}),
        };
        const finalReport = finishOpenCodeTurn(current.projection, outcome.status === "succeeded");
        if (finalReport) await onEvent(finalReport);
        return outcome;
      } catch (error) {
        if (signal.aborted) return { status: "canceled" };
        if (acp.isRunning) cancel();
        const summary = error instanceof Error ? error.message : String(error);
        return {
          status: "failed",
          summary: /auth_required|unauthorized|not authenticated/i.test(summary)
            ? "OpenCode needs a sign-in. Run `opencode auth login` and try again."
            : summary,
        };
      } finally {
        signal.removeEventListener("abort", cancel);
        await delivery.idle();
        activePrompts.delete(current.sessionId);
        current.mcp.setEventHandler(null);
        current.projection.text = "";
        current.projection.thought = "";
      }
    },

    async cleanup(session): Promise<void> {
      const current = session as OpenCodeSession;
      await stopRuntime(current);
      if (runRuntimes.get(current.runId)?.acp === current.acp) runRuntimes.delete(current.runId);
    },

    async canResumeSession(runId): Promise<boolean> {
      if (sessions.has(runId)) return true;
      const run = await runsRepo.findRunById(runId);
      if (!run?.sessionId) return false;
      sessions.set(runId, run.sessionId);
      return true;
    },

    async deleteSession(runId): Promise<void> {
      const sessionId = sessions.get(runId);
      sessions.delete(runId);
      if (sessionId) {
        const acp = runRuntimes.get(runId)?.acp ?? await ensureServer();
        await acp.sendRequest("session/delete", { sessionId }).catch(() => {});
      }
    },

    updateConfig(next) {
      adoptConfig(config, next as OpenCodeAdapterConfig);
      models = null;
      catalogGeneration += 1;
    },

    invalidateCatalogs() {
      models = null;
      catalogGeneration += 1;
      commandsByCwd.clear();
      versionText = "";
    },

    async shutdown(): Promise<void> {
      closed = true;
      sessions.clear();
      await Promise.all([
        ...[...runRuntimes.values()].map((runtime) => stopRuntime(runtime).catch(() => {})),
        ...[...textGenerationCleanups].map((dispose) => dispose().catch(() => {})),
      ]);
      runRuntimes.clear();
      activePrompts.clear();
      if (server) {
        const current = server;
        server = null;
        await current.stop();
      }
    },

    async listModels(): Promise<ModelInfo[]> {
      if (models && models.length > 0) return models;
      const generation = catalogGeneration;
      loadEffortCache();
      const probed = await catalog(os.homedir());
      const ids = probed.models.map((model) => model.id);
      const selected = resolveCatalogDefaultId(ids, config.defaultModel);
      models = probed.models.map((model) => withEffort({ ...model, isDefault: model.id === selected }));
      probeEffort(ids, generation);
      return models;
    },

    async listCommands(workspacePath?: string): Promise<CommandInfo[]> {
      const cwd = absoluteCwd(workspacePath || os.homedir());
      const cached = commandsByCwd.get(cwd);
      if (cached) return cached;
      const probed = await catalog(cwd);
      return probed.commands;
    },

    async getAccountInfo(): Promise<AccountInfo> {
      requireBinary();
      const [version, auth] = await Promise.all([
        runBinary(["--version"], 10_000),
        runBinary(["auth", "list", "--format", "json"], 15_000),
      ]);
      versionText = `${version.stdout}\n${version.stderr}`;
      const parsed = parseOpenCodeVersion(versionText);
      const compatibility = openCodeCliCompatibility(versionText);
      const providers = parseOpenCodeAuthList(auth.stdout).map((integration) => integration.name);
      return {
        account: providers.length > 0 ? { type: "opencode", providers } : null,
        requiresOpenaiAuth: false,
        cli: {
          version: parsed?.version ?? null,
          channel: null,
          outdated: compatibility === "unsupported",
          compatibility,
          minimumVersion: MINIMUM_OPENCODE_VERSION,
          source: "configured",
          authLoginCommand: "opencode auth login",
          updateMethod: "cli",
        },
      };
    },

    async updateCli(): Promise<CliUpdateResult> {
      const result = await runBinary(["upgrade"], 120_000);
      versionText = "";
      const output = `${result.stdout}${result.stderr}`.trim();
      return { success: result.code === 0, output };
    },
  };
}
