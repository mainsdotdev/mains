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
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { findCopilotBinaryPath } from "../providers.utils";
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
} from "../../../../shared/adapter.types";
import type { ModeId } from "../../../../shared/modes";
import {
  requestToolApproval,
} from "../../runs/user-input-broker";
import type { ToolApprovalRequest } from "../../runs/runs.dto";
import {
  adoptConfig,
  createLogger,
  ALLOWED_TOOLS_SET,
  extractArtifactsFromToolOutput,
  formatContextSection,
  appendPromptSections,
  resolveCatalogDefaultId,
} from "./adapter.shared";
import type { MainsToolContext } from "./mains-tools.core";
import { toCopilotTools } from "./mains-tools.registry";
import { guardsService } from "../../guards/guards.service";

// ─────────────────────────────────────────────────────────────
// SDK type sketches (the SDK is loaded via dynamic import to keep the
// adapter compilable without the package installed)
// ─────────────────────────────────────────────────────────────

interface CopilotClientOptions {
  /** How the SDK reaches the CLI — the only field it reads to resolve the CLI
   *  binary. Built via `RuntimeConnection.forStdio/forTcp/forUri`. */
  connection?: unknown;
  /** Working directory for the spawned CLI. Note this does *not* set the
   *  working directory of sessions — see `SessionConfig.workingDirectory`. */
  workingDirectory?: string;
  logLevel?: "none" | "error" | "warning" | "info" | "debug" | "all";
  env?: Record<string, string | undefined>;
  gitHubToken?: string;
  useLoggedInUser?: boolean;
  onListModels?: () => Promise<unknown[]> | unknown[];
  telemetry?: {
    otlpEndpoint?: string;
    filePath?: string;
    exporterType?: string;
    sourceName?: string;
    captureContent?: boolean;
  };
  onGetTraceContext?: () => { traceparent?: string; tracestate?: string } | Promise<{ traceparent?: string; tracestate?: string }>;
}

interface CopilotTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  handler: (args: any, invocation: { sessionId: string; toolCallId: string; toolName: string; arguments: unknown }) => Promise<unknown> | unknown;
  overridesBuiltInTool?: boolean;
  skipPermission?: boolean;
}

type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

/** The UI mode the agent runs in for a given turn (passed to `send`/`sendAndWait`). */
type AgentMode = "interactive" | "plan" | "autopilot" | "shell";

interface MCPServerConfig {
  type?: "local" | "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirectory?: string;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
  timeout?: number;
}

interface SessionConfig {
  sessionId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemMessage?: { content: string } | { mode: "append"; content?: string } | { mode: "replace"; content: string };
  streaming?: boolean;
  /**
   * The directory the agent treats as its workspace. This is the *only* field
   * the SDK forwards to the runtime — an older `cwd` key is silently dropped,
   * which leaves the session running in the client process's own cwd. Always
   * set this explicitly rather than relying on the client's `workingDirectory`.
   */
  workingDirectory?: string;
  tools?: CopilotTool[];
  mcpServers?: Record<string, MCPServerConfig>;
  customAgents?: unknown[];
  agent?: string;
  skillDirectories?: string[];
  disabledSkills?: string[];
  infiniteSessions?: { enabled?: boolean; backgroundCompactionThreshold?: number; bufferExhaustionThreshold?: number };
  availableTools?: string[];
  excludedTools?: string[];
  onPermissionRequest: (
    request: { kind: string; toolCallId?: string; [key: string]: any },
    invocation: { sessionId: string },
  ) => Promise<{ kind: string; rules?: unknown[] }> | { kind: string; rules?: unknown[] };
  onUserInputRequest?: (
    request: { question: string; choices?: string[]; allowFreeform?: boolean },
    invocation: { sessionId: string },
  ) => Promise<{ answer: string; wasFreeform: boolean }> | { answer: string; wasFreeform: boolean };
  /**
   * Invoked when the agent finishes planning (in plan mode) and asks to exit
   * plan mode. We resolve it with `exit_only` so the agent stops without
   * implementing — the plan is surfaced in the timeline with an "Apply Plan"
   * button that runs it as a follow-up turn (mirrors the Claude plan-mode UX).
   */
  onExitPlanModeRequest?: (
    request: { summary?: string; planContent?: string; actions?: string[]; recommendedAction?: string },
    invocation: { sessionId: string },
  ) =>
    | Promise<{ approved: boolean; selectedAction?: string; feedback?: string }>
    | { approved: boolean; selectedAction?: string; feedback?: string };
  hooks?: {
    onPreToolUse?: (
      input: { toolName: string; toolArgs: unknown; timestamp: number; cwd: string },
      invocation: { sessionId: string },
    ) => Promise<{ permissionDecision?: "allow" | "deny" | "ask"; permissionDecisionReason?: string; modifiedArgs?: unknown } | void> | { permissionDecision?: "allow" | "deny" | "ask"; permissionDecisionReason?: string; modifiedArgs?: unknown } | void;
  };
}

interface SessionEvent {
  type: string;
  content?: string;
  deltaContent?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  error?: string;
  data?: unknown;
  ephemeral?: boolean;
  id?: string;
  timestamp?: string;
  [key: string]: any;
}

interface CopilotSdkSession {
  send(options: { prompt: string; agentMode?: AgentMode }): Promise<string>;
  sendAndWait(options: { prompt: string; agentMode?: AgentMode }, timeout?: number): Promise<SessionEvent | undefined>;
  on(handler: (event: SessionEvent) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  setModel(model: string, options?: { reasoningEffort?: ReasoningEffort }): Promise<void>;
  /**
   * Lazily-created typed RPC surface for low-level session APIs. `mode.set` is
   * the authoritative way to put the session into "plan"/"autopilot" — the
   * per-message `agentMode` on `send` only annotates the turn and defaults to
   * the session's current mode, so it does not switch the mode on its own.
   */
  rpc?: {
    mode?: {
      set?: (params: { mode: AgentMode }) => Promise<void>;
      get?: () => Promise<string>;
    };
    plan?: {
      // We only render a flat checklist, so `readSqlTodos` is enough.
      // `readSqlTodosWithDependencies` additionally returns the dependency edges
      // between todos, if the UI ever grows a structured progress view.
      readSqlTodos?: () => Promise<{
        rows?: Array<{ id?: string; title?: string; description?: string; status?: string }>;
      }>;
    };
    commands?: {
      list?: (params?: Record<string, unknown>) => Promise<{
        commands?: Array<{
          name: string;
          description?: string;
          input?: { hint?: string; required?: boolean };
          experimental?: boolean;
          allowDuringAgentExecution?: boolean;
        }>;
      }>;
    };
  };
}

interface CopilotModelInfo {
  id: string;
  name?: string;
  capabilities?: {
    supports?: { vision?: boolean; reasoningEffort?: boolean };
    limits?: { max_prompt_tokens?: number; max_context_window_tokens?: number };
  };
  policy?: { state?: string };
  billing?: { multiplier?: number };
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

interface SessionMetadata {
  sessionId: string;
  startTime: Date;
  modifiedTime: Date;
  summary?: string;
  isRemote: boolean;
  context?: { cwd: string; gitRoot?: string; repository?: string; branch?: string };
}

interface CopilotClientInterface {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
  createSession(config: SessionConfig): Promise<CopilotSdkSession>;
  resumeSession(sessionId: string, config: Omit<SessionConfig, "sessionId">): Promise<CopilotSdkSession>;
  listSessions(filter?: {
    workingDirectory?: string;
    gitRoot?: string;
    repository?: string;
    branch?: string;
  }): Promise<SessionMetadata[]>;
  deleteSession(sessionId: string): Promise<void>;
  ping(message?: string): Promise<{ message: string; timestamp: number; protocolVersion?: number }>;
  /**
   * Memoizes for the client's entire lifetime — the cache is only cleared by
   * `stop()`/`forceStop()`. Prefer `rpc.models.list`, which hits the runtime
   * every call; see the driver's `listModels`.
   */
  listModels(): Promise<CopilotModelInfo[]>;
  getStatus(): Promise<{ version?: string; protocolVersion?: number }>;
  getAuthStatus(): Promise<{
    isAuthenticated: boolean;
    authType?: string;
    host?: string;
    login?: string;
    statusMessage?: string;
  }>;
  getLastSessionId(): Promise<string | undefined>;
  /** Client-scoped typed RPC surface (account quota, uncached model listing). */
  rpc?: {
    account?: {
      getQuota?: (params?: { gitHubToken?: string }) => Promise<{
        quotaSnapshots?: Record<string, CopilotQuotaSnapshot | undefined>;
      }>;
    };
    models?: {
      list?: (params?: { gitHubToken?: string }) => Promise<{ models?: CopilotModelInfo[] }>;
    };
  };
}

interface CopilotQuotaSnapshot {
  isUnlimitedEntitlement?: boolean;
  /** False when the plan carries no allowance for this quota at all. */
  hasQuota?: boolean;
  entitlementRequests?: number;
  usedRequests?: number;
  remainingPercentage?: number;
  overage?: number;
  resetDate?: string;
}

// ─────────────────────────────────────────────────────────────
// Per-run session state (handed back to Core as opaque `session`)
// ─────────────────────────────────────────────────────────────

interface CopilotSession {
  runId: string;
  sdkSession: CopilotSdkSession;
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
 * Ephemeral normally means "don't persist", and everything so marked is dropped
 * on arrival — but usage accounting and failures still have to get through.
 * `model.call_failure` in particular is *always* ephemeral, so without this it
 * could never reach its case in mapSessionEvent.
 */
const EPHEMERAL_EXEMPT_EVENTS = new Set([
  "assistant.usage",
  "assistant.turn_end",
  "session.usage_info",
  "session.error",
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
  let client: CopilotClientInterface | null = null;
  let clientInitPromise: Promise<void> | null = null;
  let initError: Error | null = null;
  let currentClientCwd: string | null = null;

  // Correlate tool events when toolName/input is missing in completion events.
  // Module-scoped: shared across runs (matches today's adapter behavior).
  const toolCallIndex = new Map<
    string,
    { toolName: string; input?: unknown; startedAt?: number }
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
  const commandsCache = new Map<string, { commands: CommandInfo[]; timestamp: number }>();

  // Model listing cache. The SDK client memoizes models for its entire lifetime
  // and only drops that cache on stop(), so a sign-in or plan change would never
  // reach the picker without an app restart. We read the uncached RPC instead and
  // expire our own copy, which keeps the renderer's refetch meaningful.
  const MODELS_CACHE_TTL_MS = 60_000;
  let modelsCache: { models: ModelInfo[]; timestamp: number } | null = null;

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
  function approveAllPermissions(): { kind: string } {
    return { kind: "approve-once" };
  }

  function buildPermissionHandler(runId: string) {
    return async (
      request: { kind: string; toolCallId?: string; [key: string]: any },
    ): Promise<{ kind: string; rules?: unknown[] }> => {
      // Valid kinds are: shell, write, read, mcp, url, memory, custom-tool,
      // hook, extension-management, extension-permission-access. `read`/`shell`
      // map to the pre-approved Read/Bash tools (see COPILOT_EXTRA_ALLOWED), so
      // they are granted here too; everything else falls through to the user.
      // (The former `task` / `ask_user` branches were dead — neither is a
      // permission kind. `ask_user` is routed to onUserInputRequest instead.)
      if (request.kind === "read" || request.kind === "shell") {
        return { kind: "approved" };
      }

      if (request.kind === "custom-tool" && typeof request.toolName === "string" && request.toolName.startsWith("mcp__mains__")) {
        return { kind: "approved" };
      }

      const req: ToolApprovalRequest = {
        requestId: `perm-${runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runId,
        toolName: `[permission:${request.kind}]`,
        toolInput: request as Record<string, unknown>,
        kind: "tool_approval",
        question: `Copilot requests "${request.kind}" permission`,
        timestamp: Date.now(),
      };

      const response = await requestToolApproval(req);
      return { kind: response.approved ? "approved" : "denied-interactively-by-user" };
    };
  }

  function buildPreToolUseHook(
    runId: string,
    permissionMode: string,
    toolPolicy?: WorkRunToolPolicy | null,
  ) {
    const bypass = permissionMode === "bypassPermissions" || permissionMode === "allow";
    // Copilot names its built-in tools in lowercase ("bash", "read"), the
    // policy uses the canonical names ("Bash") — compare case-insensitively.
    const disallowed = new Set(
      (toolPolicy?.disallowedTools ?? []).map((t) => t.toLowerCase()),
    );
    const allowedOverride = toolPolicy?.allowedTools
      ? new Set(toolPolicy.allowedTools.map((t) => t.toLowerCase()))
      : null;
    return async (
      input: { toolName: string; toolArgs: unknown; timestamp: number; cwd: string },
    ): Promise<{ permissionDecision?: "allow" | "deny" | "ask"; permissionDecisionReason?: string; modifiedArgs?: unknown } | void> => {
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
      if (guardHook) {
        const guardResult = await guardHook(input);
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
        toolInput: (typeof input.toolArgs === "object" && input.toolArgs !== null
          ? input.toolArgs
          : { args: input.toolArgs }) as Record<string, unknown>,
        kind: "tool_approval",
        timestamp: Date.now(),
      };

      const response = await requestToolApproval(req);
      if (response.approved) {
        return { permissionDecision: "allow" };
      }
      return { permissionDecision: "deny", permissionDecisionReason: "User denied" };
    };
  }

  function buildUserInputHandler(runId: string) {
    return async (
      request: { question: string; choices?: string[]; allowFreeform?: boolean },
    ): Promise<{ answer: string; wasFreeform: boolean }> => {
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
  function buildExitPlanModeHandler(runId: string) {
    return async (request: {
      summary?: string;
      planContent?: string;
      actions?: string[];
      recommendedAction?: string;
    }): Promise<{ approved: boolean; selectedAction?: string }> => {
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

  /** Tear the client down and reset every piece of state derived from it. */
  async function disposeClient(reason: string): Promise<void> {
    const current = client;
    client = null;
    clientInitPromise = null;
    initError = null;
    currentClientCwd = null;
    // Both are per-runtime/per-account, so a fresh client must re-read them.
    modelsCache = null;
    commandsCache.clear();

    if (!current) return;
    logInfo(`Disposing Copilot client: ${reason}`);
    try {
      let timer: NodeJS.Timeout | undefined;
      const stopTimeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Stop timed out")), 5000);
      });
      try {
        await Promise.race([current.stop(), stopTimeout]);
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
      }
    }
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

  async function ensureClient(workspaceCwd?: string): Promise<CopilotClientInterface> {
    // The client is process-wide and long-lived; every session carries its own
    // `workingDirectory`, so a workspace switch no longer needs to tear it down.
    // (It used to: session `cwd` was being dropped by the SDK, so rebuilding the
    // client was the only way to move the agent — which also killed any run still
    // streaming on another workspace, and incidentally papered over a dead CLI
    // child by rebuilding it. Hence the explicit health check below.)
    // `currentClientCwd` is now just a record of what the client was built with.
    if (client) {
      if (await isClientAlive(client)) {
        if (workspaceCwd && currentClientCwd !== workspaceCwd) {
          logInfo(
            `Reusing client (built for ${currentClientCwd ?? "no cwd"}); session will run in ${workspaceCwd}`,
          );
        }
        return client;
      }
      await disposeClient("runtime connection is closed");
    }

    if (initError) {
      const err = initError;
      initError = null;
      clientInitPromise = null;
      throw err;
    }

    if (clientInitPromise) {
      await clientInitPromise;
      if (client) return client;
      throw initError || new Error("Failed to initialize Copilot client");
    }

    clientInitPromise = (async () => {
      try {
        // ESM-only SDK; dodge Vite's CJS rewrite of import().
        const dynamicImport = new Function("specifier", "return import(specifier)");
        const CopilotSDK = await dynamicImport("@github/copilot-sdk").catch(() => null);

        if (!CopilotSDK) {
          throw new Error(
            "Copilot SDK (@github/copilot-sdk) is not installed. Please install it to use the Copilot provider.",
          );
        }

        const CopilotClient = (CopilotSDK as any).CopilotClient;
        if (!CopilotClient) {
          throw new Error("Could not find CopilotClient in @github/copilot-sdk");
        }

        try {
          const { execSync } = require("child_process");
          execSync("gh auth status", { stdio: "pipe", timeout: 5000 });
        } catch {
          throw new Error(
            "GitHub CLI is not authenticated. Please run `gh auth login` in your terminal to sign in.",
          );
        }

        const { RuntimeConnection } = CopilotSDK as any;

        // `start()` is called explicitly below; the SDK dropped the `autoStart`
        // option (along with `autoRestart` / `isChildProcess` / `cliArgs` —
        // extra CLI args now live on `RuntimeConnection.forStdio({ args })`).
        const options: CopilotClientOptions = {
          logLevel: config.logLevel ?? "info",
        };

        // The SDK resolves the CLI *only* from `connection`. With no explicit
        // path it falls back to `getBundledCliPath()`, which returns
        // `@github/copilot/index.js` and is spawned via `process.execPath`. In a
        // packaged app that execPath is the Electron binary (runAsNode fuse
        // disabled) and the .js lives inside app.asar, so the child exits 0
        // immediately → "CLI server exited unexpectedly with code 0". Handing the
        // SDK the unpacked native binary (`config.binary`) avoids all of that.
        if (config.cliUrl) {
          options.connection = RuntimeConnection.forUri(config.cliUrl);
        } else if (config.useStdio === false && config.port) {
          options.connection = RuntimeConnection.forTcp({
            port: config.port,
            ...(config.binary ? { path: config.binary } : {}),
          });
        } else {
          options.connection = RuntimeConnection.forStdio(
            config.binary ? { path: config.binary } : {},
          );
        }

        if (workspaceCwd) {
          options.workingDirectory = workspaceCwd;
          currentClientCwd = workspaceCwd;
          logInfo(`Setting client cwd to: ${workspaceCwd}`);
        }

        client = new CopilotClient(options) as CopilotClientInterface;

        try {
          await client.start();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes("ENOENT")) {
            throw new Error(
              `Copilot CLI binary not found. Please ensure GitHub Copilot CLI is installed and the path is correct. Current path: ${config.binary || "bundled"}`,
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

        await client.ping("init");
        logInfo("Client initialized successfully");
      } catch (error) {
        initError = error instanceof Error ? error : new Error(String(error));
        logError("Failed to initialize client:", initError.message);
        throw initError;
      }
    })();

    await clientInitPromise;
    if (!client) throw initError || new Error("Failed to initialize Copilot client");
    return client;
  }

  // ─────────────────────────────────────────────────────────────
  // Session config builder (shared by createSession + resumeSession)
  // ─────────────────────────────────────────────────────────────

  function buildBaseSessionConfig(
    runId: string,
    execution: WorkRunRequest["execution"],
    permissionMode: string,
    mode?: ModeId,
    toolPolicy?: WorkRunToolPolicy | null,
  ): Omit<SessionConfig, "sessionId"> {
    const base: Omit<SessionConfig, "sessionId"> = {
      streaming: true,
      // Authoritative for this session — see SessionConfig.workingDirectory.
      // The client's own working directory is whatever the first caller
      // happened to supply (often none), so it can't be relied on here.
      workingDirectory: execution.cwd,
      onPermissionRequest:
        permissionMode === "bypassPermissions" || permissionMode === "allow"
          ? approveAllPermissions
          : buildPermissionHandler(runId),
      tools: buildMainsTools(execution.workspaceId, execution.cwd, runId, mode),
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
    base.hooks = { onPreToolUse: buildPreToolUseHook(runId, permissionMode, toolPolicy) };
    base.onUserInputRequest = buildUserInputHandler(runId);

    if (permissionMode === "plan") {
      base.onExitPlanModeRequest = buildExitPlanModeHandler(runId);
    }

    return base;
  }

  // ─────────────────────────────────────────────────────────────
  // Event mapping: Copilot SDK events → WorkRunEvent
  // ─────────────────────────────────────────────────────────────

  function getPayload(event: SessionEvent): any {
    return (event as any)?.data ?? event;
  }

  function isEphemeral(event: SessionEvent): boolean {
    return Boolean((event as any)?.ephemeral === true);
  }

  function mapSessionEvent(event: SessionEvent, runId: string): WorkRunEvent | null {
    const ts = Date.now();

    if (!EPHEMERAL_EXEMPT_EVENTS.has(event.type) && isEphemeral(event)) return null;

    const payload = getPayload(event);

    switch (event.type) {
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
        const p = payload as Record<string, unknown>;
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
        const p = payload as Record<string, unknown>;
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
        const p = payload as Record<string, unknown>;
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
          accumulateUsage(runId, payload as Record<string, unknown>);
        }
        return null;
      }

      // Live context-window snapshot (ephemeral, renderer-only) for the
      // ContextUsageRing above the input.
      case "session.usage_info": {
        const p = payload as Record<string, unknown>;
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
        const content = String((payload as any)?.content ?? event.content ?? "").trim();
        if (!content) return null;
        return {
          type: "artifact",
          kind: "report",
          content,
          metadata: { source: "assistant.message" },
        };
      }

      case "assistant.message_delta":
      case "assistant.reasoning_delta":
        return null;

      case "assistant.reasoning":
        return {
          type: "log",
          message: `[reasoning] ${String((payload as any)?.content ?? event.content ?? "")}`,
          level: "info",
          ts,
        };

      case "tool.execution_start": {
        const toolCallId = String((payload as any)?.toolCallId ?? (event as any)?.id ?? "");
        const toolName = String(
          (payload as any)?.toolName ?? (payload as any)?.name ?? event.toolName ?? "unknown",
        );
        const input =
          (payload as any)?.toolInput ??
          (payload as any)?.input ??
          (payload as any)?.toolArgs ??
          (payload as any)?.arguments ??
          event.toolInput ??
          (event as any).toolArgs ??
          (event as any).arguments;

        if (toolCallId) {
          toolCallIndex.set(toolCallId, { toolName, input, startedAt: ts });
        }

        // Suppressed (exit_plan_mode, todo-bookkeeping sql): keep the index
        // entry so the completion resolves the tool name, but don't render it.
        if (isSuppressedToolCall(toolName, input)) return null;

        return {
          type: "tool_call",
          toolName,
          input,
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
        const toolCallId = String((payload as any)?.toolCallId ?? (event as any)?.id ?? "");
        const prev = toolCallId ? toolCallIndex.get(toolCallId) : undefined;

        const toolName = String(
          (payload as any)?.toolName ?? prev?.toolName ?? event.toolName ?? "unknown",
        );
        const input =
          (payload as any)?.toolInput ??
          (payload as any)?.input ??
          (payload as any)?.toolArgs ??
          (payload as any)?.arguments ??
          prev?.input ??
          event.toolInput ??
          (event as any).toolArgs ??
          (event as any).arguments;

        const success = (payload as any)?.success;
        const result =
          (payload as any)?.result ??
          (payload as any)?.toolOutput ??
          (payload as any)?.output ??
          event.toolOutput;

        const error =
          formatToolError((payload as any)?.error ?? event.error) ??
          (success === false ? "tool_failed" : undefined);

        if (toolCallId) toolCallIndex.delete(toolCallId);

        if (isSuppressedToolCall(toolName, input)) return null;

        return {
          type: "tool_call",
          toolName,
          input,
          output: result,
          error,
          endedAt: ts,
          metadata: {
            phase: event.type === "tool.execution_complete" ? "complete" : "end",
            toolCallId: toolCallId || undefined,
            success: typeof success === "boolean" ? success : undefined,
            toolTelemetry: (payload as any)?.toolTelemetry,
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
  ): Promise<void> {
    let result: { rows?: Array<{ id?: string; title?: string; description?: string; status?: string }> } | undefined;
    try {
      result = await sdkSession.rpc?.plan?.readSqlTodos?.();
    } catch (err) {
      logWarn("Failed to read session todos:", err);
      return;
    }

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
  ): () => void {
    return sdkSession.on((event: SessionEvent) => {
      if (signal.aborted) return;

      // Todos changed (ephemeral signal): read the session SQL todos and emit a
      // fresh UpdateTodos snapshot. Handled before the ephemeral early-return.
      if (event.type === "session.todos_changed") {
        void emitTodosSnapshot(sdkSession, runId, onEvent);
        return;
      }

      // Capture a completing tool's name before mapSessionEvent clears the
      // index (used for the sql → todos refresh below).
      const completedToolName =
        event.type === "tool.execution_end" || event.type === "tool.execution_complete"
          ? (() => {
              const p = getPayload(event);
              const tcId = String((p as any)?.toolCallId ?? (event as any)?.id ?? "");
              return String(
                (p as any)?.toolName ?? (tcId ? toolCallIndex.get(tcId)?.toolName : "") ?? "",
              );
            })()
          : "";

      if (!EPHEMERAL_EXEMPT_EVENTS.has(event.type) && isEphemeral(event)) return;

      // Backstop for todo writes the agent makes through the raw `sql` tool,
      // which don't reliably raise session.todos_changed. emitTodosSnapshot
      // dedupes, so a redundant read here costs nothing.
      if (completedToolName === "sql") {
        void emitTodosSnapshot(sdkSession, runId, onEvent);
      }

      const mapped = mapSessionEvent(event, runId);
      if (!mapped) return;

      void Promise.resolve(onEvent(mapped)).catch((err) =>
        logError("onEvent threw:", err),
      );

      // Tool-completion events also yield artifact events for written files / patches
      if (event.type === "tool.execution_end" || event.type === "tool.execution_complete") {
        const payload = getPayload(event);
        const toolCallId = String((payload as any)?.toolCallId ?? "");
        const prev = toolCallId ? toolCallIndex.get(toolCallId) : undefined;
        const toolName = String((payload as any)?.toolName ?? prev?.toolName ?? "unknown");
        const toolOutput =
          (payload as any)?.result ??
          (payload as any)?.toolOutput ??
          (payload as any)?.output ??
          (event as any)?.toolOutput;

        if (toolOutput) {
          for (const artEvent of extractArtifactsFromToolOutput(toolName, toolOutput)) {
            void Promise.resolve(onEvent(artEvent)).catch((err) =>
              logError("Error emitting artifact:", err),
            );
          }
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Translate sendAndWait result + signal state → DriverOutcome
  // ─────────────────────────────────────────────────────────────

  function buildSuccessOutcome(
    result: SessionEvent | undefined,
    runId: string,
  ): DriverOutcome {
    const finalText =
      (result as any)?.content ??
      (result as any)?.output ??
      (result as any)?.data?.content ??
      (result as any)?.data?.output ??
      "";
    return {
      status: "succeeded",
      summary: finalText || "Completed successfully",
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

    if (errorMessage.includes("aborted") || errorMessage.includes("abort")) {
      return {
        status: "canceled",
        summary: "Run was aborted",
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
  async function emitPendingToolInterruptions(onEvent: WorkRunEventHandler): Promise<void> {
    const ts = Date.now();
    for (const [toolCallId, toolInfo] of toolCallIndex) {
      await onEvent({
        type: "tool_call",
        toolName: toolInfo.toolName,
        input: toolInfo.input as Record<string, unknown> | undefined,
        error: "Interrupted",
        endedAt: ts,
        metadata: { phase: "complete", toolCallId, interrupted: true },
      });
    }
    toolCallIndex.clear();
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

      const copilotClient = await ensureClient(request.execution.cwd);

      const overrides = (request.configSnapshot ?? {}) as Record<string, unknown>;
      const permissionMode =
        (typeof overrides.permissionMode === "string" && overrides.permissionMode) ||
        config.permissionMode ||
        "default";

      const sessionConfig: SessionConfig = {
        sessionId: runId,
        ...buildBaseSessionConfig(
          runId,
          request.execution,
          permissionMode,
          request.mode,
          request.toolPolicy,
        ),
      };

      if (model || config.defaultModel) {
        sessionConfig.model = model || config.defaultModel;
      }

      const overrideEffort =
        typeof overrides.modelReasoningEffort === "string"
          ? overrides.modelReasoningEffort
          : typeof overrides.effortLevel === "string" && overrides.effortLevel
            ? overrides.effortLevel
            : undefined;
      const reasoningEffort = (overrideEffort ?? (config as any).modelReasoningEffort) as
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

      const sdkSession = await copilotClient.createSession(sessionConfig);
      const agentMode = agentModeForPermission(permissionMode);
      logInfo(
        `Created Copilot session for run ${runId} (model: ${sessionConfig.model || "default"}, permissionMode: ${permissionMode}, agentMode: ${agentMode ?? "(default)"})`,
      );

      const session: CopilotSession = {
        runId,
        sdkSession,
        agentMode,
      };
      return { session, prompt: buildStartPrompt(request) };
    },

    async resumeSession(request: WorkRunContinueRequest): Promise<AcquiredSession> {
      const { runId } = request;

      const copilotClient = await ensureClient(request.execution.cwd);
      // Same precedence as createSession: run snapshot beats provider config,
      // so a resumed run keeps the permission mode it started with.
      const resumeOverrides = (request.configSnapshot ?? {}) as Record<string, unknown>;
      const permissionMode =
        (typeof resumeOverrides.permissionMode === "string" && resumeOverrides.permissionMode) ||
        config.permissionMode ||
        "default";

      const resumeConfig: Omit<SessionConfig, "sessionId"> = {
        ...buildBaseSessionConfig(
          runId,
          request.execution,
          permissionMode,
          request.mode,
          request.toolPolicy,
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

      const resumeReasoningEffort = (config as any).modelReasoningEffort as
        | ReasoningEffort
        | undefined;
      if (resumeReasoningEffort) resumeConfig.reasoningEffort = resumeReasoningEffort;

      const sdkSession = await copilotClient.resumeSession(runId, resumeConfig);
      logInfo(`Resumed Copilot session for run ${runId}`);

      const session: CopilotSession = {
        runId,
        sdkSession,
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

      // Wire abort: when signal fires, ask SDK to abort
      const onAbort = () => {
        cs.sdkSession.abort().catch((err) => logError("Error aborting session:", err));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      // Wire SDK event stream
      cs.unsubscribe = wireSessionListener(cs.sdkSession, cs.runId, onEvent, signal);

      // Expose onEvent to session-config callbacks (e.g. the exit-plan-mode
      // handler) for the duration of this turn.
      onEventByRun.set(cs.runId, onEvent);

      // Plan mode is driven by the *persistent* session mode — the per-message
      // agentMode below only annotates the turn (it defaults to the session's
      // current mode), so we must switch the session into plan mode explicitly
      // or the agent just runs interactively and implements straight away.
      if (cs.agentMode === "plan") {
        try {
          await cs.sdkSession.rpc?.mode?.set?.({ mode: "plan" });
          logInfo(`Set session mode to "plan" for run ${cs.runId}`);
        } catch (err) {
          logWarn("Failed to set session mode to plan:", err);
        }
      }

      try {
        const result = await cs.sdkSession.sendAndWait(
          cs.agentMode ? { prompt, agentMode: cs.agentMode } : { prompt },
          timeout,
        );

        if (!result) {
          await onEvent({
            type: "log",
            message: "No response received from Copilot",
            level: "warn",
            ts: Date.now(),
          });
        }

        return buildSuccessOutcome(result, cs.runId);
      } catch (error) {
        await emitPendingToolInterruptions(onEvent);
        return buildErrorOutcome(error, cs.runId, timeout, signal);
      } finally {
        onEventByRun.delete(cs.runId);
        lastTodosByRun.delete(cs.runId);
        signal.removeEventListener("abort", onAbort);
        try {
          cs.unsubscribe?.();
        } catch {
          /* ignore */
        }
      }
    },

    async cleanup(session): Promise<void> {
      const cs = session as CopilotSession;
      try {
        await cs.sdkSession.disconnect();
      } catch (err) {
        logError("Error disconnecting session:", err);
      }
    },

    async canResumeSession(runId: string): Promise<boolean> {
      try {
        const copilotClient = await ensureClient();
        const sessions = await copilotClient.listSessions();
        return sessions.some((s) => s.sessionId === runId);
      } catch (err) {
        logError("Error checking session:", err);
        return false;
      }
    },

    async deleteSession(runId: string): Promise<void> {
      try {
        const copilotClient = await ensureClient();
        await copilotClient.deleteSession(runId);
        logInfo(`Deleted session: ${runId}`);
      } catch (err) {
        logError("Error deleting session:", err);
      }
    },

    updateConfig(next) {
      adoptConfig(config, next as CopilotAdapterConfig);
    },

    async shutdown(): Promise<void> {
      toolCallIndex.clear();
      usageAccumulator.clear();
      onEventByRun.clear();
      lastTodosByRun.clear();

      await disposeClient("adapter shutdown");
      logInfo("Shutdown complete");
    },

    async generateTitle(goal: string, context?: WorkRunContextItem[]): Promise<string> {
      const copilotClient = await ensureClient();

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
      const session = await copilotClient.createSession({
        systemMessage: {
          content:
            "You are a title generator. Output ONLY a short title (3-5 words) in title case (capitalize the first letter of each word). Never explain, never use tools, never write code.",
        },
        onPermissionRequest: approveAllPermissions,
      });

      try {
        const result = await session.sendAndWait({ prompt: titlePrompt }, 15000);

        const titleText = String(
          (result as any)?.content ?? (result as any)?.data?.content ?? "",
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
        try {
          await session.disconnect();
        } catch {
          /* ignore */
        }
      }
    },

    async generateText(
      prompt: string,
      opts?: { system?: string; model?: string },
    ): Promise<string> {
      const copilotClient = await ensureClient();

      const session = await copilotClient.createSession({
        systemMessage: {
          content:
            opts?.system ??
            "You are a helpful assistant. Follow the user's instructions exactly and output only what is requested. Never use tools, never write code.",
        },
        ...(opts?.model ? { model: opts.model } : {}),
        onPermissionRequest: approveAllPermissions,
      });

      try {
        const result = await session.sendAndWait({ prompt }, 30000);
        const text = String(
          (result as any)?.content ?? (result as any)?.data?.content ?? "",
        );
        return text.trim();
      } finally {
        try {
          await session.disconnect();
        } catch {
          /* ignore */
        }
      }
    },

    async getRateLimits(): Promise<RateLimitInfo | null> {
      try {
        const copilotClient = await ensureClient();
        const result = await copilotClient.rpc?.account?.getQuota?.({});
        return mapCopilotQuota(result?.quotaSnapshots, Date.now());
      } catch (err) {
        logError("Failed to get quota:", err);
        return null;
      }
    },

    async listCommands(workspacePath?: string): Promise<CommandInfo[]> {
      const now = Date.now();
      const cacheKey = workspacePath ?? "__global__";
      const cached = commandsCache.get(cacheKey);
      if (cached && now - cached.timestamp < COMMANDS_CACHE_TTL_MS) {
        return cached.commands;
      }

      // Slash commands are session-scoped, so list them on a throwaway session
      // (commands depend on cwd; set it on the session, not the shared client,
      // to avoid tearing down an in-flight run's client).
      let session: CopilotSdkSession | null = null;
      try {
        const copilotClient = await ensureClient();
        session = await copilotClient.createSession({
          ...(workspacePath ? { workingDirectory: workspacePath } : {}),
          onPermissionRequest: approveAllPermissions,
        });

        const result = await session.rpc?.commands?.list?.();
        const raw = Array.isArray(result?.commands) ? result.commands : [];
        const commands: CommandInfo[] = raw
          .filter((c) => c && typeof c.name === "string" && c.name.length > 0)
          .map((c) => ({
            name: c.name,
            description: typeof c.description === "string" ? c.description : undefined,
            argumentHint: c.input?.hint,
            userFacing: true,
          }));

        commandsCache.set(cacheKey, { commands, timestamp: now });
        logInfo(`Listed ${commands.length} Copilot slash commands`);
        return commands;
      } catch (err) {
        logError("Failed to list commands:", err);
        return [];
      } finally {
        if (session) {
          try {
            await session.disconnect();
          } catch {
            /* ignore */
          }
        }
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
      const now = Date.now();
      if (modelsCache && now - modelsCache.timestamp < MODELS_CACHE_TTL_MS) {
        return modelsCache.models;
      }

      try {
        const copilotClient = await ensureClient();

        // Uncached RPC first; fall back to the memoizing convenience wrapper only
        // if the runtime predates the `models.list` method.
        const raw = copilotClient.rpc?.models?.list
          ? (await copilotClient.rpc.models.list({}))?.models
          : await copilotClient.listModels();

        if (!Array.isArray(raw)) {
          logWarn("Invalid models response");
          return modelsCache?.models ?? [];
        }

        // "auto" is the CLI's own synthetic entry: available on every plan and
        // never retired, so it is the stable fallback when the configured
        // default has aged out of the catalogue.
        const defaultId = resolveCatalogDefaultId(
          raw.map((model) => model.id),
          config.defaultModel,
          ["auto"],
        );

        const models = raw.map(
          (model): ModelInfo => ({
            id: model.id,
            displayName: model.name || model.id,
            isDefault: model.id === defaultId,
            capabilities: { vision: model.capabilities?.supports?.vision },
            contextWindow: model.capabilities?.limits?.max_context_window_tokens,
            supportsEffort: model.capabilities?.supports?.reasoningEffort ?? false,
            supportedEffortLevels: model.supportedReasoningEfforts,
          }),
        );

        modelsCache = { models, timestamp: now };
        logInfo(
          `Listed ${models.length} Copilot model(s): ${models.map((m) => m.id).join(", ") || "(none)"}`,
        );
        if (config.defaultModel && !models.some((m) => m.id === config.defaultModel)) {
          logWarn(
            `Configured default model "${config.defaultModel}" is not offered by the CLI; the picker will fall back to the first available model.`,
          );
        }
        return models;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/not authenticated|gh auth login/i.test(msg)) {
          throw error;
        }
        logError("Failed to list models:", error);
        // Serve the last good list rather than blanking the picker on a transient
        // RPC failure.
        return modelsCache?.models ?? [];
      }
    },

    // CLI health/version + self-update. The GitHub Copilot CLI is npm-distributed
    // (`@github/copilot`) but ships its own `copilot update` subcommand and
    // `--version`, so we drive it exactly like the other providers. We probe the
    // user's on-PATH `copilot` first (what `update` actually mutates), falling
    // back to the SDK's resolved binary, then a bare `copilot` on PATH.
    async getAccountInfo(): Promise<AccountInfo> {
      const binaryPath = findCopilotBinaryPath() ?? config.binary ?? "copilot";
      const version = await readCopilotCliVersion(binaryPath);
      // Probe the runtime's auth state — `account: null` is what the renderer's
      // preflight treats as "signed out", so it must reflect reality, not a
      // hardcoded placeholder. A client that can't start (CLI missing/broken)
      // also reads as signed out, which is the right banner for that state too.
      let account: AccountInfo["account"] = null;
      try {
        const copilotClient = await ensureClient();
        const status = await copilotClient.getAuthStatus();
        if (status?.isAuthenticated) {
          account = { type: "copilot", login: status.login ?? null };
        }
      } catch (error) {
        logWarn(
          `getAccountInfo: auth status read failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        account,
        requiresOpenaiAuth: false,
        cli: { version, channel: null, outdated: false },
      };
    },

    async updateCli(): Promise<CliUpdateResult> {
      const binaryPath = findCopilotBinaryPath() ?? config.binary ?? "copilot";
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: os.homedir(),
        PATH: [
          path.dirname(binaryPath),
          path.join(os.homedir(), ".local", "bin"),
          "/usr/local/bin",
          "/opt/homebrew/bin",
          process.env.PATH || "",
        ].join(":"),
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

const execFileAsync = promisify(execFile);

/**
 * Read the Copilot CLI version via `copilot --version` (output looks like
 * "GitHub Copilot CLI 1.0.61."). Returns the bare semver or null on any failure.
 */
async function readCopilotCliVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 8000,
    });
    const match = String(stdout).match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
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
export function resolveExitPlanDecision(): { approved: boolean; selectedAction: string } {
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
