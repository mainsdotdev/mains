import { createAsyncResourceLifecycle, type ResourceReadContext } from "../../../../runtime/async-resource-lifecycle";
import { CopilotCanceledError, createCopilotLifecycle, type CopilotSessionOwner } from "./copilot-lifecycle";
import { providerProcessPath } from "../../providers.utils";
// ─────────────────────────────────────────────────────────────
// Copilot ProviderDriver
//
// SDK-specific seam for GitHub Copilot. Wraps `@github/copilot-sdk`'s
// CopilotClient + CopilotSession. Wrapped by `createWorkRunAdapter()` in
// work-run-core.ts to expose the WorkRunAdapter interface.
//
// Differences from cursor.driver:
//   - Copilot uses `runId` directly as `sessionId` (no separate ID assignment).
//     `AcquiredSession.sessionId` is omitted; Core doesn't persist anything.
//   - No fork or review verbs.
//   - Stop reason isn't a string — final outcome is determined by inspecting
//     the result object + the AbortSignal state in executePrompt's catch.
//   - Tool-call interruption events are emitted inside Driver's catch handler;
//     only the Driver knows which tool calls were in-flight.
// ─────────────────────────────────────────────────────────────

import path from "node:path";
import os from "node:os";
import { spawnProvider as spawn } from "../provider-process";
import type {
  CopilotClient as CopilotClientInterface,
  CopilotClientOptions,
  CopilotSession as CopilotSdkSession,
  ExitPlanModeHandler,
  ExitPlanModeResult,
  MessageOptions,
  PermissionHandler,
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionHooks,
  Tool as CopilotTool,
} from "@github/copilot-sdk";
import {
  copilotAuthLoginCommand,
  copilotRuntimeArgs,
  resolveCopilotRuntime,
} from "../../providers.utils";
import type {
  AccountInfo,
  AcquiredSession,
  CliUpdateResult,
  CommandInfo,
  CopilotAdapterConfig,
  DriverOutcome,
  ModelInfo,
  ProviderDriver,
  RateLimitInfo,
  RateLimitWindow,
  WorkRunContextItem,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunRequest,
  WorkRunToolPolicy,
  WorkRunUsage,
} from "../../../../../shared/adapter.types";
import type { ModeId } from "@mains/contracts/modes";
import {
  requestToolApproval,
} from "../../../runs/user-input-broker";
import type { ToolApprovalRequest } from "../../../runs/runs.dto";
import {
  adoptConfig,
  createLogger,
  ALLOWED_TOOLS_SET,
  extractArtifactsFromToolOutput,
  formatContextSection,
  appendPromptSections,
  resolveCatalogDefaultId,
} from "../adapter.shared";
import type { MainsToolContext } from "../mains-tools.core";
import { toCopilotTools } from "../mains-tools.registry";
import { guardsService } from "../../../guards/guards.service";
import { copilotApprovalInput, mapCopilotPermissionApproval } from "./copilot-approval";

// ─────────────────────────────────────────────────────────────
// SDK types are compile-time imports; the runtime stays dynamically loaded.
// ─────────────────────────────────────────────────────────────

type ReasoningEffort = NonNullable<SessionConfig["reasoningEffort"]>;
type AgentMode = NonNullable<MessageOptions["agentMode"]>;
type CopilotQuotaSnapshot = Partial<NonNullable<
  Awaited<ReturnType<CopilotClientInterface["rpc"]["account"]["getQuota"]>>["quotaSnapshots"]
>[string]> & { hasQuota?: boolean }; // Older runtimes can omit fields or report hasQuota.

// ─────────────────────────────────────────────────────────────
// Per-run session state (handed back to Core as opaque `session`)
// ─────────────────────────────────────────────────────────────

interface CopilotSession {
  runId: string;
  sdkSession: CopilotSdkSession;
  owner: CopilotSessionOwner;
  /** UI mode for this run's turns (e.g. "plan" when permissionMode === "plan"). */
  agentMode?: AgentMode;
  /** Captured during executePrompt for use by error-path tool-call interruption emission. */
  unsubscribe?: () => void;
}

const { info: logInfo, warn: logWarn, error: logError } = createLogger("[CopilotDriver]");

// ─────────────────────────────────────────────────────────────
// Module-scoped pre-approved tool set (extends adapter.shared's set)
// ─────────────────────────────────────────────────────────────

const COPILOT_EXTRA_ALLOWED = new Set([
  "bash", "read", "glob", "grep", "report_intent", "view",
  "permission:read", "web_fetch", "permission:url", "rg",
  // `exit_plan_mode` ends plan mode — auto-allow it so it never prompts. Its
  // raw tool call is also dropped in mapSessionEvent (see SUPPRESSED_TOOLS):
  // the richer ExitPlanMode plan card we synthesize from onExitPlanModeRequest
  // (full plan + "Apply Plan" button) already covers it, so rendering both
  // would duplicate the plan as a summary-only second entry.
  "exit_plan_mode",
  // `sql` operates only on Copilot's session-state todo DB (plan/todo
  // bookkeeping), not the user's workspace — auto-allow it so the frequent
  // todo writes don't each surface an approval.
  "sql",
  // `ask_user` is a user-interaction tool, not a permission gate: the SDK
  // routes it to `onUserInputRequest` (→ buildUserInputHandler) which renders
  // the real select-option dialog. Without this, the PreToolUse hook would
  // first surface a redundant "Allow ask_user?" approval dialog before the
  // question dialog appears.
  "ask_user",
]);

function isCopilotToolAllowed(toolName: string): boolean {
  return ALLOWED_TOOLS_SET.has(toolName) || COPILOT_EXTRA_ALLOWED.has(toolName);
}

/**
 * Events that must be handled even though the SDK flags them `ephemeral`.
 * Most ephemeral events are dropped on arrival, but usage accounting and
 * failures still have to get through. Streaming deltas are handled separately
 * in wireSessionListener before this filter.
 * `model.call_failure` in particular is *always* ephemeral, so without this it
 * could never reach its case in mapSessionEvent.
 */
const EPHEMERAL_EXEMPT_EVENTS = new Set([
  "assistant.usage",
  "assistant.turn_end",
  "session.usage_info",
  "session.error",
  "session.auto_tier_switch_failed",
  "model.call_failure",
]);

// Tool calls whose raw timeline events are dropped in mapSessionEvent.
// `exit_plan_mode` is redundant with the richer ExitPlanMode plan card we
// synthesize from the onExitPlanModeRequest callback (full plan content +
// "Apply Plan" button); rendering both would show the plan twice.
const SUPPRESSED_TOOLS = new Set(["exit_plan_mode"]);

/**
 * True when a `sql` tool call is just todo bookkeeping (touches the `todos` /
 * `todo_deps` tables). Those are redundant with the TodoSummaryBar, so we hide
 * them from the timeline; non-todo SQL stays visible.
 */
export function isTodoBookkeepingSql(toolName: string, input: unknown): boolean {
  if (toolName !== "sql") return false;
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const query =
    typeof obj.query === "string" ? obj.query : typeof obj.args === "string" ? obj.args : "";
  return /\btodos\b|\btodo_deps\b/i.test(query);
}

/** Whether a tool call's raw timeline event should be dropped in mapSessionEvent. */
function isSuppressedToolCall(toolName: string, input: unknown): boolean {
  return SUPPRESSED_TOOLS.has(toolName) || isTodoBookkeepingSql(toolName, input);
}

/**
 * Render a tool-completion error as a human-readable string. The SDK reports it
 * as `{ code?, message }`, so a bare String() renders "[object Object]" in the
 * timeline. Plain strings pass through; anything else is JSON-encoded rather
 * than stringified. Pure, exposed for tests.
 */
export function formatToolError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (typeof error === "string") return error || undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const message = typeof obj.message === "string" ? obj.message : undefined;
    const code = typeof obj.code === "string" ? obj.code : undefined;
    if (message) return code ? `${message} (${code})` : message;
    if (code) return code;
    try {
      return JSON.stringify(error);
    } catch {
      return undefined;
    }
  }
  return String(error);
}

// File-creating/modifying tools (lowercased). In "acceptEdits" mode these are
// auto-approved so the agent edits freely, while any other unrecognized tool
// still prompts. Deletion is intentionally excluded — it stays gated.
const FILE_EDIT_TOOLS = new Set([
  "apply_patch", "write", "write_file", "edit", "edit_file",
  "create", "create_file", "str_replace", "str_replace_editor",
  "multiedit", "notebookedit",
]);

export function isFileEditTool(toolName: string): boolean {
  return FILE_EDIT_TOOLS.has(toolName.toLowerCase());
}

// ─────────────────────────────────────────────────────────────
// Driver factory
// ─────────────────────────────────────────────────────────────

export function createCopilotDriver(config: CopilotAdapterConfig): ProviderDriver {
  const lifecycle = createCopilotLifecycle({
    create: createClient, initialize: initializeClient,
    alive: isClientAlive, stop: stopClient, invalidate: invalidateCatalogs,
  });
  let lastAccountIdentity: string | null | undefined;

  // Correlate tool events when toolName/input is missing in completion events.
  // Native ids are session-local; include the run to isolate concurrent turns.
  const toolCallIndex = new Map<
    string,
    { runId: string; id: string; toolName: string; input?: unknown; startedAt?: number }
  >();

  // Per-run event sink, populated for the duration of executePrompt. Lets
  // session-config callbacks (e.g. the exit-plan-mode handler, registered at
  // session-creation time before onEvent exists) emit WorkRunEvents.
  const onEventByRun = new Map<string, WorkRunEventHandler>();

  // Per-run last-emitted todo snapshot (JSON), so repeated reads (every sql
  // call) only emit an UpdateTodos event when the todos actually changed.
  const lastTodosByRun = new Map<string, string>();

  // Slash-command listing cache (keyed by workspace path). Listing spins up a
  // throwaway session, so cache it for a short window.
  const COMMANDS_CACHE_TTL_MS = 60_000;
  const commandsCache = createAsyncResourceLifecycle<CommandInfo[]>({
    ttlMs: COMMANDS_CACHE_TTL_MS, load: (key, context) => loadCommands(key || undefined, context),
  });

  // Model listing cache. The SDK client memoizes models for its entire lifetime
  // and only drops that cache on stop(), so a sign-in or plan change would never
  // reach the picker without an app restart. We read the uncached RPC instead and
  // expire our own copy, which keeps the renderer's refetch meaningful.
  const MODELS_CACHE_TTL_MS = 60_000;
  const modelsCache = createAsyncResourceLifecycle<ModelInfo[]>({
    ttlMs: MODELS_CACHE_TTL_MS,
  });
  function invalidateCatalogs(): void {
    modelsCache.invalidate();
    commandsCache.invalidate();
  }

  async function loadModels(copilotClient: CopilotClientInterface, context: ResourceReadContext): Promise<ModelInfo[]> {
    const raw = copilotClient.rpc?.models?.list
      ? (await copilotClient.rpc.models.list({}))?.models
      : await copilotClient.listModels();

    context.assertCurrent();
    if (!Array.isArray(raw)) throw new Error("Invalid models response");

    // The runtime can list every model twice. Ids key the catalogue — a
    // paired phone stores it under them — so keep the first of each.
    const seen = new Set<string>();
    const unique = raw.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });

    // "auto" is the CLI's own synthetic entry: available on every plan and
    // never retired, so it is the stable fallback when the configured
    // default has aged out of the catalogue.
    const defaultId = resolveCatalogDefaultId(
      unique.map((model) => model.id),
      config.defaultModel,
      ["auto"],
    );

    const models = unique.map(
      (model): ModelInfo => ({
        id: model.id,
        displayName: model.name || model.id,
        isDefault: model.id === defaultId,
        capabilities: { vision: model.capabilities?.supports?.vision },
        contextWindow: model.capabilities?.limits?.max_context_window_tokens,
        supportsEffort: model.capabilities?.supports?.reasoningEffort ?? false,
        supportsFastMode: model.id === "auto",
        supportedEffortLevels: model.supportedReasoningEfforts,
      }),
    );

    logInfo(
      `Listed ${models.length} Copilot model(s): ${models.map((m) => m.id).join(", ") || "(none)"}`,
    );
    if (config.defaultModel && !models.some((m) => m.id === config.defaultModel)) {
      logWarn(
        `Configured default model "${config.defaultModel}" is not offered by the CLI; the picker will fall back to the first available model.`,
      );
    }
    return models;
  }

  async function loadCommands(workspacePath: string | undefined, context: ResourceReadContext): Promise<CommandInfo[]> {
    // Slash commands are session-scoped, so list them on a throwaway session
    // (commands depend on cwd; set it on the session, not the shared client,
    // to avoid tearing down an in-flight run's client).
    let owner: CopilotSessionOwner | undefined;
    try {
      owner = await lifecycle.open(undefined, (client) => client.createSession({
        ...(workspacePath ? { workingDirectory: workspacePath } : {}),
        onPermissionRequest: approveAllPermissions,
      }));
      context.assertCurrent();
      const session = owner.session;
      const result = await owner.run(() => session.rpc.commands.list());
      context.assertCurrent();
      const raw = Array.isArray(result?.commands) ? result.commands : [];
      const commands: CommandInfo[] = raw
        .filter((c) => c && typeof c.name === "string" && c.name.length > 0)
        .map((c) => ({
          name: c.name,
          description: typeof c.description === "string" ? c.description : undefined,
          argumentHint: c.input?.hint,
          userFacing: true,
        }));

      logInfo(`Listed ${commands.length} Copilot slash commands`);
      return commands;
    } finally {
      await owner?.close();
    }
  }

  // Per-run usage accumulator.
  const usageAccumulator = new Map<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalCostUsd: number;
      numTurns: number;
      model: string;
      modelUsage: Record<string, { costUSD: number; inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
    }
  >();

  function getOrCreateUsage(runId: string) {
    let acc = usageAccumulator.get(runId);
    if (!acc) {
      acc = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0,
        numTurns: 0,
        model: "",
        modelUsage: {},
      };
      usageAccumulator.set(runId, acc);
    }
    return acc;
  }

  function accumulateUsage(runId: string, payload: Record<string, unknown>) {
    const acc = getOrCreateUsage(runId);
    const input = typeof payload.inputTokens === "number" ? payload.inputTokens : 0;
    const output = typeof payload.outputTokens === "number" ? payload.outputTokens : 0;
    const cacheRead = typeof payload.cacheReadTokens === "number" ? payload.cacheReadTokens : 0;

    // `copilotUsage` used to carry a `tokenDetails[]` array we mined for the
    // cache-write count; it is now just `{ totalNanoAiu }`, so the event's own
    // `cacheWriteTokens` is the only source.
    const cacheWrite = typeof payload.cacheWriteTokens === "number" ? payload.cacheWriteTokens : 0;

    acc.inputTokens += input;
    acc.outputTokens += output;
    acc.cacheReadTokens += cacheRead;
    acc.cacheWriteTokens += cacheWrite;

    const rawModel = typeof payload.model === "string" ? payload.model : "";
    const model = rawModel.replace(/(\d+)\.(\d+)/g, "$1-$2");
    if (model) {
      acc.model = model;
      if (!acc.modelUsage[model]) {
        acc.modelUsage[model] = { costUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
      }
      acc.modelUsage[model].inputTokens += input;
      acc.modelUsage[model].outputTokens += output;
      acc.modelUsage[model].cacheReadInputTokens += cacheRead;
      acc.modelUsage[model].cacheCreationInputTokens += cacheWrite;
    }
  }

  function flushUsage(runId: string): WorkRunUsage | undefined {
    const acc = usageAccumulator.get(runId);
    usageAccumulator.delete(runId);
    if (!acc || (acc.inputTokens === 0 && acc.outputTokens === 0)) {
      return undefined;
    }
    return {
      totalCostUsd: undefined,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cacheReadTokens: acc.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens,
      numTurns: acc.numTurns,
      model: acc.model || undefined,
      modelUsage: Object.keys(acc.modelUsage).length > 0 ? acc.modelUsage : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Permission & tool approval handlers (per-run closures)
  // ─────────────────────────────────────────────────────────────

  // Mirrors the SDK's exported `approveAll` (`() => ({ kind: "approve-once" })`).
  // The CLI honors "approve-once" as an execution grant; a bare "approved" is an
  // acknowledgment kind the permission system does not treat as a grant, which
  // left bypass-mode file reads denied ("permission issue accessing the file
  // system"). Primary bypass approval flows through the PreToolUse hook's
  // `permissionDecision: "allow"`; this is the fallback for permission requests
  // the CLI raises outside the hook.
  const approveAllPermissions: PermissionHandler = (request, invocation) => {
    // Background discovery/generation sessions have no user approval surface.
    // Defer required managed approvals rather than manufacturing consent.
    if (request.managedApprovalRequired || invocation.managedSettingsEnabled) return { kind: "no-result" };
    return { kind: "approve-once" };
  };

  function buildPermissionHandler(runId: string, permissionMode: string, assertCurrent: () => void): PermissionHandler {
    return async (request) => {
      assertCurrent();
      // Valid kinds are: shell, write, read, mcp, url, memory, custom-tool,
      // hook, extension-management, extension-permission-access. `read`/`shell`
      // map to the pre-approved Read/Bash tools (see COPILOT_EXTRA_ALLOWED), so
      // they are granted here too; everything else falls through to the user.
      // (The former `task` / `ask_user` branches were dead — neither is a
      // permission kind. `ask_user` is routed to onUserInputRequest instead.)
      // Managed approval takes precedence over bypass and trusted-tool grants.
      if (!request.managedApprovalRequired && (
        permissionMode === "bypassPermissions" || permissionMode === "allow" ||
        request.kind === "read" || request.kind === "shell" ||
        (request.kind === "custom-tool" && request.toolName.startsWith("mcp__mains__"))
      )) {
        return { kind: "approve-once" };
      }

      const req: ToolApprovalRequest = {
        requestId: `perm-${runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runId,
        ...mapCopilotPermissionApproval(request),
        kind: "tool_approval",
        timestamp: Date.now(),
      };

      const response = await requestToolApproval(req);
      assertCurrent();
      return response.approved
        ? { kind: "approve-once", approvedInteractively: true }
        : { kind: "reject" };
    };
  }

  function buildPreToolUseHook(
    runId: string,
    permissionMode: string,
    toolPolicy: WorkRunToolPolicy | null | undefined,
    assertCurrent: () => void,
  ): NonNullable<SessionHooks["onPreToolUse"]> {
    const bypass = permissionMode === "bypassPermissions" || permissionMode === "allow";
    // Copilot names its built-in tools in lowercase ("bash", "read"), the
    // policy uses the canonical names ("Bash") — compare case-insensitively.
    const disallowed = new Set(
      (toolPolicy?.disallowedTools ?? []).map((t) => t.toLowerCase()),
    );
    const allowedOverride = toolPolicy?.allowedTools
      ? new Set(toolPolicy.allowedTools.map((t) => t.toLowerCase()))
      : null;
    return async (input) => {
      assertCurrent();
      // A policy-denied tool is denied outright — before bypass, which grants
      // permission but must not resurrect a tool the mode removed.
      if (disallowed.has(input.toolName.toLowerCase())) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: "Tool not available in this space mode",
        };
      }

      // Bypass mode: auto-allow every tool (matches the Claude driver's bypass
      // path). `ask_user` needs no exemption — allowing it here simply lets the
      // SDK route it to onUserInputRequest, which surfaces the real dialog. We
      // short-circuit before the guard hook to preserve the historical bypass
      // behavior (which installed no PreToolUse hook at all, so guards never ran).
      if (bypass) {
        return { permissionDecision: "allow" };
      }

      const guardHook = await guardsService.buildCopilotGuardHook();
      assertCurrent();
      if (guardHook) {
        const guardResult = await guardHook({
          toolName: input.toolName, toolArgs: input.toolArgs,
          timestamp: input.timestamp.getTime(), cwd: input.workingDirectory,
        });
        assertCurrent();
        if (guardResult?.permissionDecision === "deny") {
          return guardResult;
        }
      }

      const baselineAllowed = allowedOverride
        ? allowedOverride.has(input.toolName.toLowerCase())
        : isCopilotToolAllowed(input.toolName);
      if (baselineAllowed) {
        return { permissionDecision: "allow" };
      }

      // With a replacement allowlist (chat mode) MCP tools are not blanket
      // trusted — anything outside the list falls through to the approval
      // dialog like any other tool.
      if (!allowedOverride && input.toolName.startsWith("mcp__")) {
        return { permissionDecision: "allow" };
      }

      // "Auto accept edits": approve file-creating/modifying tools without
      // prompting (still gating everything else, e.g. unknown/destructive tools).
      if (permissionMode === "acceptEdits" && isFileEditTool(input.toolName)) {
        return { permissionDecision: "allow" };
      }

      const req: ToolApprovalRequest = {
        requestId: `tool-${runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runId,
        toolName: input.toolName,
        toolInput: copilotApprovalInput(input.toolArgs, input.toolName),
        kind: "tool_approval",
        timestamp: Date.now(),
      };

      const response = await requestToolApproval(req);
      assertCurrent();
      if (response.approved) {
        return { permissionDecision: "allow" };
      }
      return { permissionDecision: "deny", permissionDecisionReason: "User denied" };
    };
  }

  function buildUserInputHandler(runId: string, assertCurrent: () => void): NonNullable<SessionConfig["onUserInputRequest"]> {
    return async (request) => {
      assertCurrent();
      const options = request.choices?.map((c) => ({ label: c }));
      const req: ToolApprovalRequest = {
        requestId: `ask-${runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runId,
        toolName: "AskUser",
        kind: "ask_user",
        question: request.question,
        options,
        timestamp: Date.now(),
      };

      const response = await requestToolApproval(req);
      assertCurrent();
      return { answer: response.answer || "", wasFreeform: true };
    };
  }

  /**
   * Exit-plan-mode handler (plan mode only). When the agent finishes planning
   * it asks to exit plan mode; we surface the proposed plan as an `ExitPlanMode`
   * tool call (so the renderer shows it with an "Apply Plan" button) and resolve
   * with `exit_only` so the agent stops without implementing. The user then
   * applies the plan, which runs it as a follow-up turn. This mirrors the Claude
   * plan-mode UX exactly.
   *
   * The plan tool call is emitted as a start→complete pair sharing one
   * toolCallId, awaited in order: a lone "complete" with no matching "start" is
   * dropped by the run-session projector, and onEvent is consumed fire-and-forget
   * upstream, so we must await the start's persistence before emitting complete.
   */
  function buildExitPlanModeHandler(runId: string, assertCurrent: () => void): ExitPlanModeHandler {
    return async (request) => {
      assertCurrent();
      const planContent = String(request.planContent ?? request.summary ?? "").trim();
      const onEvent = onEventByRun.get(runId);

      if (onEvent && planContent) {
        const ts = Date.now();
        const toolCallId = `exitplan-${runId}-${ts}`;
        const input = { plan: planContent };
        try {
          await onEvent({
            type: "tool_call",
            toolName: "ExitPlanMode",
            input,
            startedAt: ts,
            metadata: { phase: "start", toolCallId },
          });
          await onEvent({
            type: "tool_call",
            toolName: "ExitPlanMode",
            input,
            startedAt: ts,
            endedAt: ts,
            metadata: { phase: "complete", toolCallId },
          });
        } catch (err) {
          logError("Error emitting ExitPlanMode tool call:", err);
        }
      }

      assertCurrent();
      return resolveExitPlanDecision();
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Mains tool registration
  // ─────────────────────────────────────────────────────────────

  function buildMainsTools(
    workspaceId: string | null,
    rootPath: string | null = null,
    runId: string | null = null,
    mode?: ModeId,
  ): CopilotTool[] {
    const ctx: MainsToolContext = { workspaceId, rootPath, runId };
    return toCopilotTools(ctx, mode);
  }

  // ─────────────────────────────────────────────────────────────
  // SDK client lifecycle
  // ─────────────────────────────────────────────────────────────

  async function stopClient(current: CopilotClientInterface): Promise<void> {
    try {
      let timer: NodeJS.Timeout | undefined;
      const stopTimeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Stop timed out")), 5000);
      });
      try {
        const errors = await Promise.race([current.stop(), stopTimeout]);
        if (errors.length) throw errors[0];
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      try {
        await current.forceStop();
      } catch (err) {
        if (!(err instanceof Error && err.message.includes("ERR_STREAM_DESTROYED"))) {
          logWarn("Error force stopping client:", err);
        }
        throw err;
      }
    }
  }

  async function createClient(workspaceCwd?: string): Promise<CopilotClientInterface> {
    // Current SDK releases expose both ESM and CJS entry points. The explicit
    // native path also avoids launching Electron as Node in packaged builds.
    const settings = { ...config };
    const CopilotSDK = await import("@github/copilot-sdk");
    const runtime = resolveCopilotRuntime(settings.binary);
    if (!settings.cliUrl && !runtime) {
      throw new Error("Copilot is included with Mains. Reinstall Mains to restore its runtime.");
    }
    const options: CopilotClientOptions = { logLevel: settings.logLevel ?? "info" };
    if (settings.cliUrl) {
      options.connection = CopilotSDK.RuntimeConnection.forUri(settings.cliUrl);
    } else {
      const connection = { path: runtime!.path, args: copilotRuntimeArgs(runtime!) };
      options.connection = settings.useStdio === false && settings.port
        ? CopilotSDK.RuntimeConnection.forTcp({ ...connection, port: settings.port })
        : CopilotSDK.RuntimeConnection.forStdio(connection);
      // forUri rejects these options: external runtimes own their auth. Let
      // the SDK select its normal login default when the fields are omitted.
      if (settings.githubToken !== undefined) options.gitHubToken = settings.githubToken;
      if (settings.useLoggedInUser !== undefined) options.useLoggedInUser = settings.useLoggedInUser;
    }
    if (workspaceCwd) options.workingDirectory = workspaceCwd;
    return new CopilotSDK.CopilotClient(options);
  }

  /**
   * Round-trip the runtime to confirm the client is still usable. The CLI is a
   * child process that can exit underneath us (crash, OOM, external kill), and
   * the SDK surfaces that only as "Connection is closed" thrown from whatever
   * call happens next — typically createSession, i.e. the start of a run.
   */
  async function isClientAlive(candidate: CopilotClientInterface): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Health check timed out")), 5000);
      });
      await Promise.race([candidate.ping("health"), timeout]);
      return true;
    } catch (err) {
      logWarn(
        "Copilot client health check failed:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function initializeClient(candidate: CopilotClientInterface): Promise<void> {
    try {
      await candidate.start();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("ENOENT")) {
        throw new Error(
          config.binary
            ? "Copilot runtime not found. Check the configured executable path."
            : "Copilot is included with Mains. Reinstall Mains to restore its runtime.",
        );
      } else if (errorMessage.includes("ECONNREFUSED")) {
        throw new Error(
          `Could not connect to Copilot CLI server. The server may not be running or the port may be blocked. Port: ${config.port || "stdio"}`,
        );
      } else if (errorMessage.includes("EACCES")) {
        throw new Error(
          `Permission denied when trying to start Copilot CLI. Please check file permissions. Binary path: ${config.binary || "bundled"}`,
        );
      } else if (errorMessage.includes("ETIMEDOUT")) {
        throw new Error("Connection timed out while starting Copilot CLI. The service may be unresponsive.");
      } else {
        throw new Error(`Failed to start Copilot CLI: ${errorMessage}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Session config builder (shared by createSession + resumeSession)
  // ─────────────────────────────────────────────────────────────

  function buildBaseSessionConfig(
    runId: string,
    execution: WorkRunRequest["execution"],
    permissionMode: string,
    mode: ModeId | undefined,
    toolPolicy: WorkRunToolPolicy | null | undefined,
    assertCurrent: () => void,
  ): ResumeSessionConfig {
    const base: ResumeSessionConfig = {
      streaming: true,
      // Authoritative for this session — see SessionConfig.workingDirectory.
      // The client's own working directory is whatever the first caller
      // happened to supply (often none), so it can't be relied on here.
      workingDirectory: execution.cwd,
      onPermissionRequest: buildPermissionHandler(runId, permissionMode, assertCurrent),
      tools: buildMainsTools(execution.workspaceId, execution.cwd, runId, mode).map((tool): CopilotTool => {
        const handler = tool.handler;
        return handler ? { ...tool, handler: (...args) => { assertCurrent(); return handler(...args); } } : tool;
      }),
      skillDirectories: [
        path.join(os.homedir(), ".claude", "skills"),
        path.join(os.homedir(), ".copilot", "skills"),
        path.join(execution.cwd, ".github", "skills"),
      ],
    };

    // Install the PreToolUse hook + user-input handler in every mode, including
    // bypass. Bypass auto-allows inside the hook (see buildPreToolUseHook), so
    // tool grants flow through the hook's `permissionDecision: "allow"` — the
    // same path that grants tools in every other mode. Previously bypass skipped
    // the hook and leaned solely on onPermissionRequest, which left filesystem
    // reads ungranted. Keeping onUserInputRequest installed also lets `ask_user`
    // work in bypass (it otherwise threw "no handler registered").
    base.hooks = { onPreToolUse: buildPreToolUseHook(runId, permissionMode, toolPolicy, assertCurrent) };
    base.onUserInputRequest = buildUserInputHandler(runId, assertCurrent);

    if (permissionMode === "plan") {
      base.onExitPlanModeRequest = buildExitPlanModeHandler(runId, assertCurrent);
    }

    return base;
  }

  function resolveFastMode(overrides: Record<string, unknown>): boolean | undefined {
    return typeof overrides.fastMode === "boolean" ? overrides.fastMode : config.fastMode;
  }

  async function applyAcquiredFastMode(
    sdkSession: CopilotSdkSession,
    model: string | undefined,
    fastMode: boolean | undefined,
    resuming: boolean,
  ): Promise<void> {
    if (fastMode === undefined || (model && model !== "auto")) return;
    // An explicit Auto + fast selection was already sent in capi.autoTier.
    // New sessions with Fast off use the provider's normal default routing.
    if (model === "auto" && (fastMode || !resuming)) return;

    // A continuation without a model override inherits the native session's
    // model. Never attach an Auto preference to a fixed model.
    if (!sdkSession.rpc?.model) throw new Error("Copilot runtime cannot read the session model for Fast Mode");
    const current = await sdkSession.rpc.model.getCurrent();
    if (current.modelId !== "auto") return;
    // Leave ordinary Auto routing untouched when Fast was never enabled.
    // This also avoids requiring Auto V2 tier support just to run with Fast off.
    const hasFastPreference = [current.autoTier, current.pendingAutoTier, current.activatingAutoTier].includes("fast");
    if (!fastMode && !hasFastPreference) return;
    // Omitting capi.autoTier on resume preserves its persisted value. Reset
    // explicitly when Fast is turned off, including after a cold resume.
    await sdkSession.setAutoTier(fastMode ? "fast" : null);
  }

  // ─────────────────────────────────────────────────────────────
  // Event mapping: Copilot SDK events → WorkRunEvent
  // ─────────────────────────────────────────────────────────────

  function getPayload(event: SessionEvent): Record<string, unknown> {
    // Current SDK events carry data; explicit external runtimes can still send
    // legacy fields on the envelope. Normalize that compatibility boundary once.
    return { ...event, ...event.data };
  }

  function toToolInput(input: unknown): Record<string, unknown> | undefined {
    if (input === undefined) return undefined;
    return input !== null && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : { args: input };
  }

  function isEphemeral(event: SessionEvent): boolean {
    return event.ephemeral === true;
  }

  function assistantStreamId(
    payload: Record<string, unknown>,
    runId: string,
    kind: "report" | "thinking",
  ): string | undefined {
    // A subagent's output must not enter the main agent's live transcript.
    if (payload.agentId || payload.parentToolCallId) return undefined;
    const id = payload[kind === "report" ? "messageId" : "reasoningId"];
    if (typeof id !== "string" || !id) return undefined;
    return `copilot-${kind === "report" ? "msg" : "think"}-${runId}-${id}`;
  }

  function mapSessionEvent(event: SessionEvent, runId: string): WorkRunEvent | null {
    const ts = Date.now();

    if (!EPHEMERAL_EXEMPT_EVENTS.has(event.type) && isEphemeral(event)) return null;

    const payload = getPayload(event);

    const eventType: string = event.type;
    switch (eventType) {
      case "session.auto_tier_switch_failed": {
        const reason = typeof payload.reason === "string" ? ` (${payload.reason})` : "";
        return {
          type: "log",
          message: `Copilot could not change the Auto speed setting${reason}; the previous setting remains active.`,
          level: "warn",
          ts,
        };
      }
      case "pending_messages.modified":
      case "assistant.turn_start":
      case "exit_plan_mode.requested":
      case "exit_plan_mode.completed":
      case "session.plan_changed":
      case "session.todos_changed":
        // Plan/todo lifecycle events. The plan is surfaced as an ExitPlanMode
        // tool call (onExitPlanModeRequest) and todos as an UpdateTodos snapshot
        // (wireSessionListener → emitTodosSnapshot), so these raw events would
        // only add log noise here.
        return null;

      case "assistant.turn_end": {
        const acc = usageAccumulator.get(runId);
        if (acc) acc.numTurns++;
        return null;
      }

      // Runtime + model failures. These previously fell through to the `default`
      // case and were dropped, so a failed model call or a session error left the
      // timeline silent with no indication anything had gone wrong.
      case "session.error": {
        const p = payload;
        const message = typeof p.message === "string" ? p.message : "Session error";
        const code = typeof p.errorCode === "string" ? p.errorCode : undefined;
        const status = typeof p.statusCode === "number" ? p.statusCode : undefined;
        const detail = [code, status ? `HTTP ${status}` : undefined].filter(Boolean).join(" ");
        return {
          type: "log",
          message: detail ? `${message} (${detail})` : message,
          level: "error",
          ts,
        };
      }

      case "model.call_failure": {
        const p = payload;
        const message =
          typeof p.errorMessage === "string" ? p.errorMessage : "Model call failed";
        const model = typeof p.model === "string" ? p.model : undefined;
        const status = typeof p.statusCode === "number" ? p.statusCode : undefined;
        const detail = [model, status ? `HTTP ${status}` : undefined].filter(Boolean).join(" ");
        return {
          type: "log",
          message: detail ? `${message} (${detail})` : message,
          level: "error",
          ts,
        };
      }

      case "session.compaction_start":
        return {
          type: "log",
          message: "Compacting conversation history…",
          level: "info",
          ts,
        };

      case "session.compaction_complete": {
        const p = payload;
        if (p.success === false) {
          const err = typeof p.error === "string" ? p.error : "unknown error";
          return { type: "log", message: `Compaction failed: ${err}`, level: "warn", ts };
        }
        const removed = typeof p.tokensRemoved === "number" ? p.tokensRemoved : undefined;
        return {
          type: "log",
          message: removed
            ? `Compacted conversation history (freed ~${removed} tokens)`
            : "Compacted conversation history",
          level: "info",
          ts,
        };
      }

      case "assistant.usage": {
        if (payload && typeof payload === "object") {
          accumulateUsage(runId, payload);
        }
        return null;
      }

      // Live context-window snapshot (ephemeral, renderer-only) for the
      // ContextUsageRing above the input.
      case "session.usage_info": {
        const p = payload;
        const currentTokens = typeof p.currentTokens === "number" ? p.currentTokens : 0;
        const tokenLimit = typeof p.tokenLimit === "number" ? p.tokenLimit : 0;
        if (tokenLimit <= 0 || currentTokens <= 0) return null;
        const total = Math.min(currentTokens, tokenLimit);
        const model = usageAccumulator.get(runId)?.model || config.defaultModel || undefined;
        return {
          type: "context_usage",
          totalTokens: total,
          maxTokens: tokenLimit,
          percentage: (total / tokenLimit) * 100,
          model,
          ts,
        };
      }

      case "assistant.message": {
        const content = String(payload.content ?? "").trim();
        if (!content) return null;
        const streamId = assistantStreamId(payload, runId, "report");
        const providerMessageId = payload.apiCallId || payload.messageId;
        return {
          type: "artifact",
          kind: "report",
          content,
          metadata: { source: "assistant.message", ...(streamId ? { streamId } : {}),
            ...(typeof providerMessageId === "string" && providerMessageId
              ? { providerMessageId, messagePhase: "commentary" } : {}) },
        };
      }

      case "assistant.message_delta":
      case "assistant.reasoning_delta":
        // Accumulated and emitted ephemerally by wireSessionListener.
        return null;

      case "assistant.reasoning":
        return {
          type: "log",
          message: `[reasoning] ${String(payload.content ?? "")}`,
          level: "info",
          ts,
        };

      case "tool.execution_start": {
        const toolCallId = String(payload.toolCallId ?? event.id ?? "");
        const toolName = String(
          payload.toolName ?? payload.name ?? "unknown",
        );
        const input =
          payload.toolInput ??
          payload.input ??
          payload.toolArgs ??
          payload.arguments;

        if (toolCallId) {
          toolCallIndex.set(JSON.stringify([runId, toolCallId]), { runId, id: toolCallId, toolName, input, startedAt: ts });
        }

        // Suppressed (exit_plan_mode, todo-bookkeeping sql): keep the index
        // entry so the completion resolves the tool name, but don't render it.
        if (isSuppressedToolCall(toolName, input)) return null;

        return {
          type: "tool_call",
          toolName,
          input: toToolInput(input),
          startedAt: ts,
          metadata: {
            phase: "start",
            toolCallId: toolCallId || undefined,
            rawType: event.type,
          },
        };
      }

      // Current runtimes only emit `tool.execution_complete`; `tool.execution_end`
      // is kept as a fallback because `config.binary` / `config.cliUrl` can point
      // the driver at an older CLI than the one bundled with the app.
      case "tool.execution_end":
      case "tool.execution_complete": {
        const toolCallId = String(payload.toolCallId ?? event.id ?? "");
        const prev = toolCallId ? toolCallIndex.get(JSON.stringify([runId, toolCallId])) : undefined;

        const toolName = String(
          payload.toolName ?? prev?.toolName ?? "unknown",
        );
        const input =
          payload.toolInput ??
          payload.input ??
          payload.toolArgs ??
          payload.arguments ??
          prev?.input;

        const success = payload.success;
        const result =
          payload.result ??
          payload.toolOutput ??
          payload.output;

        const error =
          formatToolError(payload.error) ??
          (success === false ? "tool_failed" : undefined);

        if (toolCallId) toolCallIndex.delete(JSON.stringify([runId, toolCallId]));

        if (isSuppressedToolCall(toolName, input)) return null;

        return {
          type: "tool_call",
          toolName,
          input: toToolInput(input),
          output: result,
          error,
          endedAt: ts,
          metadata: {
            phase: event.type === "tool.execution_complete" ? "complete" : "end",
            toolCallId: toolCallId || undefined,
            success: typeof success === "boolean" ? success : undefined,
            toolTelemetry: payload.toolTelemetry,
            rawType: event.type,
          },
        };
      }

      case "session.idle":
        return null;

      default:
        // Unmapped events are internal lifecycle noise (hook.start/end,
        // command.*, extension_context, …). Dropping them keeps run_artifacts
        // from bloating with raw "[event] …" dumps. Add an explicit case above
        // when a new event needs surfacing.
        return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Prompt building
  // ─────────────────────────────────────────────────────────────

  function buildStartPrompt(request: WorkRunRequest): string {
    const workspaceInfo = `Working directory: ${request.execution.cwd}`;
    let prompt: string;

    if (request.context && request.context.length > 0) {
      const contextParts = formatContextSection(request.context);
      prompt = `${workspaceInfo}\n\nContext:\n${contextParts}\n\n---\n\n ${request.goal}`;
    } else {
      prompt = `${workspaceInfo}\n\n ${request.goal}`;
    }

    return appendPromptSections(prompt, {
      contextIssues: request.contextIssues,
      contextSignals: request.contextSignals,
      contextFiles: request.contextFiles,
      attachments: request.attachments,
      runId: request.runId,
    });
  }

  function buildContinuePrompt(request: WorkRunContinueRequest): string {
    let prompt = request.message;

    if (request.context && request.context.length > 0) {
      const contextParts = formatContextSection(request.context);
      prompt = `Context:\n${contextParts}\n\n---\n\n${request.message}`;
    }

    return appendPromptSections(prompt, {
      contextIssues: request.contextIssues,
      contextSignals: request.contextSignals,
      contextFiles: request.contextFiles,
      attachments: request.attachments,
      runId: request.runId,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Todo snapshots (plan/progress tracking)
  // ─────────────────────────────────────────────────────────────

  /**
   * Read Copilot's session SQL todos and emit them as an `UpdateTodos` snapshot
   * tool call. Triggered on `session.todos_changed`, and also after each `sql`
   * tool completes — the agent writes its todos through raw SQL and those writes
   * don't reliably raise the event, so the post-sql read is the backstop. Both
   * paths dedupe against the last snapshot. The renderer strips these from the timeline
   * (groupKey "task-plan") and renders the latest snapshot in the sticky
   * TodoSummaryBar. start→complete are awaited in order (a lone "complete" is
   * dropped by the run-session projector — see buildExitPlanModeHandler).
   */
  async function emitTodosSnapshot(
    sdkSession: CopilotSdkSession,
    runId: string,
    onEvent: WorkRunEventHandler,
    owner: CopilotSessionOwner,
  ): Promise<void> {
    let result: Awaited<ReturnType<CopilotSdkSession["rpc"]["plan"]["readSqlTodos"]>> | undefined;
    try {
      result = await sdkSession.rpc?.plan?.readSqlTodos?.();
    } catch (err) {
      logWarn("Failed to read session todos:", err);
      return;
    }

    if (!owner.running) return;
    const todos = mapCopilotTodos(result?.rows);
    if (todos.length === 0) return;

    // Dedupe: only emit when the snapshot actually changed (we read on every
    // sql call, including no-op SELECTs and unchanged updates).
    const todosJson = JSON.stringify(todos);
    if (lastTodosByRun.get(runId) === todosJson) return;
    lastTodosByRun.set(runId, todosJson);

    const ts = Date.now();
    const toolCallId = `copilot-todos-${runId}-${ts}`;
    logInfo(`Emitting todos snapshot for run ${runId} (${todos.length} items)`);
    const input = { todos };
    try {
      await owner.project(async () => {
        await onEvent({
          type: "tool_call",
          toolName: "UpdateTodos",
          input,
          startedAt: ts,
          metadata: { phase: "start", toolCallId, todoItems: todos },
        });
        await onEvent({
          type: "tool_call",
          toolName: "UpdateTodos",
          input,
          startedAt: ts,
          endedAt: ts,
          metadata: { phase: "complete", toolCallId, todoItems: todos },
        });
      });
    } catch (err) {
      logError("Error emitting UpdateTodos snapshot:", err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Wire SDK session.on() to push WorkRunEvents through onEvent
  // ─────────────────────────────────────────────────────────────

  function wireSessionListener(
    sdkSession: CopilotSdkSession,
    runId: string,
    onEvent: WorkRunEventHandler,
    signal: AbortSignal,
    owner: CopilotSessionOwner,
  ): () => void {
    let active = true;
    const project: WorkRunEventHandler = (event) => owner.project(() => onEvent(event));
    // Buffers belong to this turn, including on resume; native message and
    // reasoning ids keep interleaved output blocks separate.
    const streams = new Map<string, { kind: "report" | "thinking"; content: string }>();
    const emit = (event: WorkRunEvent) => {
      void Promise.resolve(project(event)).catch((err) => logError("onEvent threw:", err));
    };
    const emitStream = (streamId: string, kind: "report" | "thinking", content: string) => {
      emit({
        type: "artifact",
        kind,
        content,
        ephemeral: true,
        streamId,
        // Retained in the final artifact for identity-based reconciliation.
        metadata: { source: kind === "report" ? "assistant.message_delta" : "assistant.reasoning_delta", streamId },
      });
    };
    const unsubscribe = sdkSession.on((event: SessionEvent) => {
      if (!active || !owner.running || signal.aborted) return;

      const eventType: string = event.type;
      if (eventType === "assistant.message_delta" || eventType === "assistant.reasoning_delta") {
        const payload = getPayload(event);
        const kind = eventType === "assistant.message_delta" ? "report" : "thinking";
        const streamId = assistantStreamId(payload, runId, kind);
        const delta = payload.deltaContent;
        if (!streamId || typeof delta !== "string" || !delta) return;
        const content = (streams.get(streamId)?.content ?? "") + delta;
        streams.set(streamId, { kind, content });
        emitStream(streamId, kind, content);
        return;
      }

      if (eventType === "assistant.message" || eventType === "assistant.reasoning") {
        const payload = getPayload(event);
        const kind = eventType === "assistant.message" ? "report" : "thinking";
        const streamId = assistantStreamId(payload, runId, kind);
        if (streamId && streams.delete(streamId)) {
          // Keep the authoritative message visible until its DB row arrives.
          // Thinking has no matching report row, so clear its live preview.
          emitStream(streamId, kind, kind === "report" ? String(payload.content ?? "").trim() : "");
        }
      }

      // Todos changed (ephemeral signal): read the session SQL todos and emit a
      // fresh UpdateTodos snapshot. Handled before the ephemeral early-return.
      if (event.type === "session.todos_changed") {
        void emitTodosSnapshot(sdkSession, runId, onEvent, owner);
        return;
      }

      // Capture a completing tool's name before mapSessionEvent clears the
      // index (used for the sql → todos refresh below).
      const completedToolName =
        eventType === "tool.execution_end" || event.type === "tool.execution_complete"
          ? (() => {
              const p = getPayload(event);
              const tcId = String(p.toolCallId ?? event.id ?? "");
              return String(
                p.toolName ?? (tcId ? toolCallIndex.get(JSON.stringify([runId, tcId]))?.toolName : "") ?? "",
              );
            })()
          : "";

      if (!EPHEMERAL_EXEMPT_EVENTS.has(event.type) && isEphemeral(event)) return;

      // Backstop for todo writes the agent makes through the raw `sql` tool,
      // which don't reliably raise session.todos_changed. emitTodosSnapshot
      // dedupes, so a redundant read here costs nothing.
      if (completedToolName === "sql") {
        void emitTodosSnapshot(sdkSession, runId, onEvent, owner);
      }

      const mapped = mapSessionEvent(event, runId);
      if (!mapped) return;

      emit(mapped);
      if (eventType === "session.error") {
        const message = getPayload(event).message;
        owner.cancel(new Error(typeof message === "string" ? message : "Copilot session error"));
      }

      // Tool-completion events also yield artifact events for written files / patches
      if (eventType === "tool.execution_end" || event.type === "tool.execution_complete") {
        const payload = getPayload(event);
        const toolCallId = String(payload.toolCallId ?? "");
        const prev = toolCallId ? toolCallIndex.get(JSON.stringify([runId, toolCallId])) : undefined;
        const toolName = String(payload.toolName ?? prev?.toolName ?? "unknown");
        const toolOutput =
          payload.result ??
          payload.toolOutput ??
          payload.output;

        if (toolOutput) {
          for (const artEvent of extractArtifactsFromToolOutput(toolName, toolOutput)) {
            void Promise.resolve(project(artEvent)).catch((err) =>
              logError("Error emitting artifact:", err),
            );
          }
        }
      }
    });
    return () => {
      if (!active) return;
      active = false;
      unsubscribe();
      // Abort, timeout or an incomplete response must not leave a stale preview.
      for (const [streamId, stream] of streams) {
        void owner.project(() => onEvent({ type: "artifact", kind: stream.kind, content: "", ephemeral: true, streamId }), true).catch(() => {});
      }
      streams.clear();
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Translate sendAndWait result + signal state → DriverOutcome
  // ─────────────────────────────────────────────────────────────

  function buildSuccessOutcome(
    result: SessionEvent | undefined,
    runId: string,
  ): DriverOutcome {
    const payload = result ? getPayload(result) : {};
    const finalText = payload.content ?? payload.output;
    return {
      status: "succeeded",
      summary: typeof finalText === "string" && finalText ? finalText : "Completed successfully",
      usage: flushUsage(runId),
    };
  }

  function buildErrorOutcome(
    err: unknown,
    runId: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): DriverOutcome {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (signal.aborted) {
      return {
        status: "canceled",
        summary: "Run was aborted",
        usage: flushUsage(runId),
      };
    }

    if (errorMessage.includes("timed out") || errorMessage.toLowerCase().includes("timeout")) {
      return {
        status: "failed",
        summary: `Request timed out after ${timeoutMs / 1000} seconds.`,
        usage: flushUsage(runId),
      };
    }

    return {
      status: "failed",
      summary: errorMessage,
      usage: flushUsage(runId),
    };
  }

  /** Emit phase=complete events for any tool calls still pending when an error fires. */
  async function emitPendingToolInterruptions(onEvent: WorkRunEventHandler, runId: string): Promise<void> {
    const ts = Date.now();
    for (const [key, toolInfo] of toolCallIndex) {
      if (toolInfo.runId !== runId) continue;
      const toolCallId = toolInfo.id;
      toolCallIndex.delete(key);
      await onEvent({
        type: "tool_call",
        toolName: toolInfo.toolName,
        input: toToolInput(toolInfo.input),
        error: "Interrupted",
        endedAt: ts,
        metadata: { phase: "complete", toolCallId, interrupted: true },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ProviderDriver implementation
  // ─────────────────────────────────────────────────────────────

  /**
   * The session's system message: workspace context first, then the
   * mode/space instruction delta, then the per-run system prompt.
   */
  function buildSystemMessage(
    rootPath: string,
    systemPrompt: string | null | undefined,
    extraInstructions: string | null | undefined,
  ): { content: string } {
    const workspaceContext = `You are working in the directory: ${rootPath}\nAll file operations should be relative to this workspace root.`;
    const parts = [workspaceContext, extraInstructions, systemPrompt].filter(
      (part): part is string => Boolean(part),
    );
    return { content: parts.join("\n\n") };
  }

  return {
    async createSession(request: WorkRunRequest): Promise<AcquiredSession> {
      const { runId, model, systemPrompt } = request;

      const overrides = request.configSnapshot ?? {};
      const permissionMode =
        (typeof overrides.permissionMode === "string" && overrides.permissionMode) ||
        config.permissionMode ||
        "default";

      let sessionOwner!: CopilotSessionOwner;
      const sessionConfig: SessionConfig = {
        sessionId: runId,
        ...buildBaseSessionConfig(
          runId,
          request.execution,
          permissionMode,
          request.mode,
          request.toolPolicy,
          () => sessionOwner.assertActive(),
        ),
      };

      if (model || config.defaultModel) {
        sessionConfig.model = model || config.defaultModel;
      }
      const fastMode = resolveFastMode(overrides);
      if (sessionConfig.model === "auto" && fastMode) sessionConfig.capi = { autoTier: "fast" };

      const overrideEffort =
        typeof overrides.modelReasoningEffort === "string"
          ? overrides.modelReasoningEffort
          : typeof overrides.effortLevel === "string" && overrides.effortLevel
            ? overrides.effortLevel
            : undefined;
      const reasoningEffort = (overrideEffort ?? config.modelReasoningEffort) as
        | ReasoningEffort
        | undefined;
      if (reasoningEffort) {
        sessionConfig.reasoningEffort = reasoningEffort;
      }

      sessionConfig.systemMessage = buildSystemMessage(
        request.execution.cwd,
        systemPrompt,
        request.extraInstructions,
      );

      const owner = await lifecycle.open(request.execution.cwd, (client, scope) => { sessionOwner = scope; return client.createSession(sessionConfig); });
      const sdkSession = owner.session;
      try { await owner.run(() => applyAcquiredFastMode(sdkSession, sessionConfig.model, fastMode, false)); }
      catch (error) { await owner.close(); throw error; }
      const agentMode = agentModeForPermission(permissionMode);
      logInfo(
        `Created Copilot session for run ${runId} (model: ${sessionConfig.model || "default"}, permissionMode: ${permissionMode}, agentMode: ${agentMode ?? "(default)"})`,
      );

      const session: CopilotSession = {
        runId,
        sdkSession, owner,
        agentMode,
      };
      return { session, prompt: buildStartPrompt(request) };
    },

    async resumeSession(request: WorkRunContinueRequest): Promise<AcquiredSession> {
      const { runId } = request;

      // Same precedence as createSession: run snapshot beats provider config,
      // so a resumed run keeps the permission mode it started with.
      const resumeOverrides = request.configSnapshot ?? {};
      const permissionMode =
        (typeof resumeOverrides.permissionMode === "string" && resumeOverrides.permissionMode) ||
        config.permissionMode ||
        "default";

      let sessionOwner!: CopilotSessionOwner;
      const resumeConfig: ResumeSessionConfig = {
        ...buildBaseSessionConfig(
          runId,
          request.execution,
          permissionMode,
          request.mode,
          request.toolPolicy,
          () => sessionOwner.assertActive(),
        ),
      };
      // Re-apply the composed system message: resumeSession rebuilds the
      // session config from scratch, so without this the mode delta and the
      // run's system prompt would silently drop off on the second turn.
      resumeConfig.systemMessage = buildSystemMessage(
        request.execution.cwd,
        request.systemPrompt,
        request.extraInstructions,
      );

      const resumeModel = request.model || config.defaultModel;
      if (resumeModel) resumeConfig.model = resumeModel;
      const fastMode = resolveFastMode(resumeOverrides);
      if (resumeConfig.model === "auto" && fastMode) resumeConfig.capi = { autoTier: "fast" };

      const resumeReasoningEffort = (typeof resumeOverrides.modelReasoningEffort === "string"
        ? resumeOverrides.modelReasoningEffort : config.modelReasoningEffort) as
        | ReasoningEffort
        | undefined;
      if (resumeReasoningEffort) resumeConfig.reasoningEffort = resumeReasoningEffort;

      const owner = await lifecycle.open(request.execution.cwd, (client, scope) => { sessionOwner = scope; return client.resumeSession(runId, resumeConfig); });
      const sdkSession = owner.session;
      try { await owner.run(() => applyAcquiredFastMode(sdkSession, resumeConfig.model, fastMode, true)); }
      catch (error) { await owner.close(); throw error; }
      logInfo(`Resumed Copilot session for run ${runId}`);

      const session: CopilotSession = {
        runId,
        sdkSession, owner,
        agentMode: agentModeForPermission(permissionMode),
      };
      return { session, prompt: buildContinuePrompt(request) };
    },

    async executePrompt(
      session,
      prompt,
      onEvent,
      signal,
    ): Promise<DriverOutcome> {
      const cs = session as CopilotSession;
      const timeout = config.timeout ?? 3_600_000;
      if (signal.aborted || !cs.owner.active) return { status: "canceled", summary: "Run was aborted" };
      if (onEventByRun.has(cs.runId)) throw new Error("Copilot run already executing");
      cs.owner.begin();
      const publish: WorkRunEventHandler = (event) => cs.owner.project(() => onEvent(event));
      const onAbort = () => cs.owner.cancel();
      let timer: ReturnType<typeof setTimeout> | undefined;
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        cs.unsubscribe = wireSessionListener(cs.sdkSession, cs.runId, onEvent, signal, cs.owner);
        onEventByRun.set(cs.runId, publish);
        if (signal.aborted) onAbort();
        timer = setTimeout(() => cs.owner.cancel(new Error(`Request timed out after ${timeout}ms`)), timeout);
        if (cs.agentMode === "plan") {
          try { await cs.owner.run(() => cs.sdkSession.rpc.mode.set({ mode: "plan" })); }
          catch (error) { cs.owner.assertActive(); logWarn("Failed to set session mode to plan:", error); }
        }
        const result = await cs.owner.run(() => cs.sdkSession.sendAndWait(
          cs.agentMode ? { prompt, agentMode: cs.agentMode } : { prompt }, timeout,
        ));
        if (!result) await publish({ type: "log", message: "No response received from Copilot", level: "warn", ts: Date.now() });
        const payload = result ? getPayload(result) : {};
        const messageId = payload.apiCallId || payload.messageId;
        if (typeof messageId === "string" && messageId && typeof payload.content === "string" && payload.content.trim()) {
          await publish({ type: "message_phase", messageId, phase: "final_answer" });
        }
        return buildSuccessOutcome(result, cs.runId);
      } catch (error) {
        await emitPendingToolInterruptions((event) => cs.owner.project(() => onEvent(event), true), cs.runId);
        if (signal.aborted || cs.owner.signal.reason instanceof CopilotCanceledError) {
          return { status: "canceled", summary: "Run was aborted", usage: flushUsage(cs.runId) };
        }
        return buildErrorOutcome(error, cs.runId, timeout, signal);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (onEventByRun.get(cs.runId) === publish) {
          onEventByRun.delete(cs.runId); lastTodosByRun.delete(cs.runId);
          for (const [key, tool] of toolCallIndex) if (tool.runId === cs.runId) toolCallIndex.delete(key);
        }
        try { cs.unsubscribe?.(); }
        finally {
          try { await cs.owner.finish(); }
          finally { await cs.owner.close(); }
        }
      }
    },

    async cleanup(session): Promise<void> {
      const cs = session as CopilotSession;
      await cs.owner.close();
    },

    async canResumeSession(runId: string): Promise<boolean> {
      try {
        const sessions = await lifecycle.read((client) => client.listSessions());
        return sessions.some((s) => s.sessionId === runId);
      } catch (err) {
        logError("Error checking session:", err);
        return false;
      }
    },

    async deleteSession(runId: string): Promise<void> {
      try {
        await lifecycle.read((client) => client.deleteSession(runId));
        logInfo(`Deleted session: ${runId}`);
      } catch (err) {
        logError("Error deleting session:", err);
      }
    },

    updateConfig(next) {
      const updated = next as CopilotAdapterConfig;
      if (["binary", "cliUrl", "useStdio", "port", "githubToken", "useLoggedInUser"].some((key) =>
        config[key as keyof CopilotAdapterConfig] !== updated[key as keyof CopilotAdapterConfig],
      )) {
        lifecycle.restart();
        invalidateCatalogs();
      }
      adoptConfig(config, updated);
    },

    invalidateCatalogs,

    async shutdown(): Promise<void> {
      modelsCache.dispose(); commandsCache.dispose();
      await lifecycle.shutdown();
      toolCallIndex.clear(); usageAccumulator.clear(); onEventByRun.clear(); lastTodosByRun.clear();
      logInfo("Shutdown complete");
    },

    async generateTitle(goal: string, context?: WorkRunContextItem[]): Promise<string> {
      let contextSnippet = "";
      if (context && context.length > 0) {
        contextSnippet = context
          .map((ctx) => {
            const header = ctx.ref ? `[${ctx.kind}: ${ctx.ref}]` : `[${ctx.kind}]`;
            return `${header} ${(ctx.content || "").substring(0, 200)}`;
          })
          .join("\n")
          .substring(0, 500);
      }

      const titlePrompt = [
        "TASK: Generate a short title (3-5 words) for the following coding task.",
        "RULES: Reply with ONLY the title (title case — capitalize each word). No quotes, no explanation, no punctuation at the end, no prefixes like 'Title:'.",
        "",
        `User's request: ${goal}`,
        contextSnippet ? `\nContext:\n${contextSnippet}` : "",
        "",
        "Title:",
      ]
        .filter(Boolean)
        .join("\n");

      // Note: previously hardcoded to "gpt-4.1-nano" for cheap title generation, but
      // GitHub deprecated that model and the SDK now rejects with "Model ... is not
      // available". Omit the model field so the SDK falls back to the user's configured
      // default (or whatever Copilot picks).
      const owner = await lifecycle.open(undefined, (client) => client.createSession({
        systemMessage: {
          content:
            "You are a title generator. Output ONLY a short title (3-5 words) in title case (capitalize the first letter of each word). Never explain, never use tools, never write code.",
        },
        onPermissionRequest: approveAllPermissions,
      }));
      const session = owner.session;

      try {
        const result = await owner.run(() => session.sendAndWait({ prompt: titlePrompt }, 15000));

        const titleText = String(
          result ? getPayload(result).content ?? "" : "",
        );

        const title = titleText
          .trim()
          .split("\n")[0]
          .trim()
          .replace(/^(title:\s*)/i, "")
          .replace(/^["'`]|["'`]$/g, "")
          .replace(/[.!?]$/, "")
          .trim();

        if (!title) throw new Error("Empty title generated");

        return title.slice(0, 50);
      } finally {
        await owner.close();
      }
    },

    async generateText(
      prompt: string,
      opts?: { system?: string; model?: string },
    ): Promise<string> {
      const owner = await lifecycle.open(undefined, (client) => client.createSession({
        systemMessage: {
          content:
            opts?.system ??
            "You are a helpful assistant. Follow the user's instructions exactly and output only what is requested. Never use tools, never write code.",
        },
        ...(opts?.model ? { model: opts.model } : {}),
        onPermissionRequest: approveAllPermissions,
      }));
      const session = owner.session;

      try {
        const result = await owner.run(() => session.sendAndWait({ prompt }, 30000));
        const text = String(
          result ? getPayload(result).content ?? "" : "",
        );
        return text.trim();
      } finally {
        await owner.close();
      }
    },

    async getRateLimits(): Promise<RateLimitInfo | null> {
      try {
        const result = await lifecycle.read((client) => client.rpc.account.getQuota({}));
        return mapCopilotQuota(result?.quotaSnapshots, Date.now());
      } catch (err) {
        logError("Failed to get quota:", err);
        return null;
      }
    },

    async listCommands(workspacePath?: string): Promise<CommandInfo[]> {
      try {
        return await lifecycle.read(async () => (await commandsCache.read(workspacePath ?? "")).value);
      } catch (error) {
        logError("Failed to list commands:", error);
        return [];
      }
    },

    // What the runtime reports here is exactly what the Copilot CLI considers
    // selectable for the signed-in account: the synthetic "auto" entry plus every
    // model the CAPI marks `model_picker_enabled`. The CLI applies that filter
    // server-side, so the wider catalogue it fetches is not reachable from the SDK
    // — if the picker only offers "auto", that is the account's entitlement
    // (e.g. Copilot Free), not a truncated response. Logged below so it is
    // diagnosable from the app log rather than looking like a failed call.
    async listModels(): Promise<ModelInfo[]> {
      try {
        return await lifecycle.read(async (client) =>
          (await modelsCache.read("", { load: (context) => loadModels(client, context) })).value);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/not authenticated|gh auth login/i.test(msg)) throw error;
        logError("Failed to list models:", error);
        return modelsCache.peek()?.value ?? [];
      }
    },

    async getAccountInfo(): Promise<AccountInfo> {
      const runtime = config.cliUrl ? null : resolveCopilotRuntime(config.binary);
      const cli: NonNullable<AccountInfo["cli"]> = {
        version: null, channel: null, outdated: false,
        ...(runtime ? {
          source: runtime.source,
          updateMethod: runtime.source === "bundled" ? "app" : "cli",
          authLoginCommand: copilotAuthLoginCommand(runtime),
        } : {}),
      };
      // A short-lived control client reads credentials saved by a completed
      // login, even if the run client was started while signed out. No model
      // session or prompt is sent; an active run is never stopped by Recheck.
      let account: AccountInfo["account"] = null;
      try {
        await lifecycle.probe(async (probe, check) => {
          cli.version = (await probe.getStatus()).version ?? null;
          const status = await probe.getAuthStatus();
          check();
          if (status?.isAuthenticated) {
            account = { type: "copilot", login: status.login ?? null };
          }
          const identity = status?.isAuthenticated
            ? `${status.host ?? ""}:${status.login ?? ""}:${status.authType ?? ""}`
            : null;
          if (identity !== lastAccountIdentity) {
            lastAccountIdentity = identity;
            lifecycle.restart();
            invalidateCatalogs();
          }
        });
      } catch (error) {
        logWarn(
          `getAccountInfo: auth status read failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { account, requiresOpenaiAuth: false, cli };
    },

    async updateCli(): Promise<CliUpdateResult> {
      if (config.cliUrl) {
        return { success: false, output: "Update Copilot on the computer hosting the connected CLI server." };
      }
      const runtime = resolveCopilotRuntime(config.binary);
      if (!runtime) return { success: false, output: "Copilot runtime not found. Reinstall Mains to restore it." };
      if (runtime.source === "bundled") {
        return { success: false, output: "Copilot is included with Mains and updates with the app. Check for Mains updates in Settings." };
      }
      const binaryPath = runtime.path;
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: os.homedir(),
        PATH: providerProcessPath(binaryPath),
      };

      return new Promise<CliUpdateResult>((resolve) => {
        const child = spawn(binaryPath, ["update"], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120000,
        });
        let out = "";
        child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
        child.on("close", (code) =>
          resolve({ success: code === 0, output: out.trim() }),
        );
        child.on("error", (err) =>
          resolve({
            success: false,
            output: String(err instanceof Error ? err.message : err),
          }),
        );
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Pure helpers exported for testing
// ─────────────────────────────────────────────────────────────

/**
 * Map a permission mode to the SDK `agentMode` for a turn. Only "plan" needs an
 * explicit mode; every other mode leaves the session at its default
 * ("interactive"). Pure, exposed for tests.
 */
export function agentModeForPermission(
  permissionMode: string | undefined,
): AgentMode | undefined {
  return permissionMode === "plan" ? "plan" : undefined;
}

/**
 * Decide how to resolve an exit-plan-mode request. We always exit plan mode
 * without auto-implementing (`exit_only`): the plan is rendered with an "Apply
 * Plan" button that runs it as a follow-up turn. Pure, exposed for tests.
 */
export function resolveExitPlanDecision(): ExitPlanModeResult {
  return { approved: true, selectedAction: "exit_only" };
}

/** Map a Copilot SQL todo status to the renderer's TodoSummaryBar status. */
function mapTodoStatus(
  status: string | undefined,
): "completed" | "in_progress" | "pending" {
  const s = String(status ?? "").toLowerCase();
  if (s === "done" || s === "completed" || s === "complete" || s === "closed") {
    return "completed";
  }
  if (s === "in_progress" || s === "in-progress" || s === "running" || s === "active") {
    return "in_progress";
  }
  return "pending";
}

/**
 * Map Copilot's session SQL todo rows to the {content, status} snapshot the
 * renderer's TodoSummaryBar consumes. Drops rows with no usable label. Pure,
 * exposed for tests.
 */
export function mapCopilotTodos(
  rows: Array<{ id?: string; title?: string; description?: string; status?: string }> | undefined,
): Array<{ content: string; status: "completed" | "in_progress" | "pending" }> {
  return (rows ?? [])
    .map((r) => ({
      content: String(r.title ?? r.description ?? r.id ?? "").trim(),
      status: mapTodoStatus(r.status),
    }))
    .filter((t) => t.content.length > 0);
}

const QUOTA_LABELS: Record<string, string> = {
  premium_interactions: "Premium requests",
  chat: "Chat",
  completions: "Completions",
};
// Known quota types first (headline premium requests), then any others.
const QUOTA_ORDER = ["premium_interactions", "chat", "completions"];

function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a quota reset to a Unix-seconds timestamp. The v1.0.1 runtime reports
 * the *snapshot* fetch time in `resetDate` (not the real reset), so only trust
 * it when it's clearly in the future; otherwise fall back to the 1st of next
 * month — Copilot premium requests reset on the monthly billing boundary
 * (matches what VS Code shows).
 */
function resolveResetSec(resetDate: string | undefined, nowMs: number): number {
  const parsed = resetDate ? Date.parse(resetDate) : NaN;
  if (Number.isFinite(parsed) && parsed > nowMs + 60 * 60 * 1000) {
    return Math.floor(parsed / 1000);
  }
  const d = new Date(nowMs);
  return Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000);
}

/**
 * Map Copilot's `account.getQuota` snapshots to a RateLimitInfo. The first two
 * metered quotas become primary / secondary windows (usedPercent = 100 −
 * remaining, reset via resolveResetSec).
 *
 * Skipped: unlimited entitlements, and quotas the plan simply doesn't include
 * (`hasQuota: false` / zero entitlement). A Copilot Free account reports
 * `premium_interactions` with `entitlementRequests: 0` and
 * `remainingPercentage: 0`, which would otherwise render as "100% used" —
 * alarming, and wrong: nothing has been consumed, the allowance is just absent.
 *
 * Pure given `nowMs`, exposed for tests.
 */
export function mapCopilotQuota(
  snapshots: Record<string, CopilotQuotaSnapshot | undefined> | undefined,
  nowMs: number,
): RateLimitInfo | null {
  if (!snapshots || typeof snapshots !== "object") return null;

  const keys = [
    ...QUOTA_ORDER.filter((k) => k in snapshots),
    ...Object.keys(snapshots).filter((k) => !QUOTA_ORDER.includes(k)),
  ];

  const windows: RateLimitWindow[] = [];
  for (const key of keys) {
    const s = snapshots[key];
    if (!s || s.isUnlimitedEntitlement) continue;
    // No allowance on this plan — which is not the same as an exhausted one.
    if (s.hasQuota === false) continue;
    if (typeof s.entitlementRequests === "number" && s.entitlementRequests <= 0) continue;
    const remaining = typeof s.remainingPercentage === "number" ? s.remainingPercentage : 0;
    const usedPercent = Math.max(0, Math.min(100, Math.round(100 - remaining)));
    const used = typeof s.usedRequests === "number" ? s.usedRequests : undefined;
    const total =
      typeof s.entitlementRequests === "number" && s.entitlementRequests > 0
        ? s.entitlementRequests
        : undefined;
    windows.push({
      usedPercent,
      resetsAt: resolveResetSec(s.resetDate, nowMs),
      label: QUOTA_LABELS[key] ?? humanizeKey(key),
      used,
      total,
    });
  }

  if (windows.length === 0) return null;
  return { primary: windows[0], secondary: windows[1] };
}

/**
 * Translate copilot's error/result into a DriverOutcome. Pure: no SDK access,
 * exposed for tests.
 */
export function classifyOutcome(args: {
  hasError: boolean;
  errorMessage?: string;
  signalAborted: boolean;
  finalText?: string;
  timeoutMs: number;
}): { status: DriverOutcome["status"]; summary: string } {
  const { hasError, errorMessage, signalAborted, finalText, timeoutMs } = args;

  if (!hasError) {
    return { status: "succeeded", summary: finalText || "Completed successfully" };
  }

  if (signalAborted) {
    return { status: "canceled", summary: "Run was aborted" };
  }

  const msg = errorMessage ?? "";
  if (msg.includes("timed out") || msg.toLowerCase().includes("timeout")) {
    return {
      status: "failed",
      summary: `Request timed out after ${timeoutMs / 1000} seconds.`,
    };
  }

  if (msg.includes("aborted") || msg.includes("abort")) {
    return { status: "canceled", summary: "Run was aborted" };
  }

  return { status: "failed", summary: msg };
}
