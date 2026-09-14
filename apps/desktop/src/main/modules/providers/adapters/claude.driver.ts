// ─────────────────────────────────────────────────────────────
// Claude ProviderDriver
//
// SDK-specific seam for Anthropic's @anthropic-ai/claude-agent-sdk. The SDK
// spawns the Claude Code CLI subprocess and exposes an AsyncGenerator
// (SDKQuery) that streams messages.
//
// Differences from cursor/copilot drivers (worth noting because they shape
// the Driver interface usage):
//
//   - SessionId is assigned by the driver, not read out of the stream: a new
//     or forked session is opened on an id we generate, so AcquiredSession
//     carries it and Core persists it before the first token. The stream is
//     still watched for a mismatch, which would mean the CLI ignored the id.
//   - SDK has both AbortController and `query.interrupt()`. Driver wires the
//     incoming AbortSignal to fire both.
//   - Per-run streaming buffers (text + thinking deltas, tool-call correlation
//     index) live on the Session object for cleanup safety. The old adapter
//     held them in factory closure scope which leaked across concurrent runs.
//
// Long-lived caches (models / commands / skills, the SDK loader itself) stay
// in the factory closure as cross-run state.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type {
  AcquiredSession,
  AgentsConfig,
  CliUpdateResult,
  ClaudeCodeAdapterConfig,
  AccountInfo,
  CommandInfo,
  DriverOutcome,
  HookMatcher,
  HooksConfig,
  ModelInfo,
  PluginDetail,
  PluginListResponse,
  MarketplaceInfo,
  ProviderDriver,
  SkillInfo,
  WorkRunContextItem,
  WorkRunContextUsageCategory,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunForkRequest,
  WorkRunRequest,
  WorkRunToolPolicy,
  WorkRunUsage,
} from "../../../../shared/adapter.types";
import {
  findClaudeBinary,
  findPackagedClaudeSdkBinary,
  resolveCandidate,
} from "../providers.utils";
import { AGENT_ID_IN_RESULT } from "../../../../shared/subagent";
import type { ModeId } from "../../../../shared/modes";
import {
  DEFAULT_CLAUDE_PERMISSION_MODE,
  isClaudePermissionMode,
} from "../../../../shared/claude-permission-modes";
import {
  cancelPendingRequest,
  requestToolApproval,
} from "../../runs/user-input-broker";
import type { ToolApprovalRequest, ToolApprovalResponse } from "../../runs/runs.dto";
import { runsRepo } from "../../runs/runs.repo";
import {
  adoptConfig,
  createLogger,
  ALLOWED_TOOLS_SET,
  resolveEffectiveAllowedTools,
  safeJson,
  extractArtifactsFromToolOutput,
  formatContextSection,
  appendPromptSections,
  resolveCatalogDefaultId,
} from "./adapter.shared";
import type { MainsToolContext } from "./mains-tools.core";
import { toClaudeTools } from "./mains-tools.registry";
import { guardsService } from "../../guards/guards.service";

// ─────────────────────────────────────────────────────────────
// SDK type sketches (the SDK is loaded via dynamic import to keep the
// driver compilable without the package installed)
// ─────────────────────────────────────────────────────────────

interface SDKHookMatcher {
  matcher?: string;
  hooks: Array<
    (
      input: Record<string, unknown>,
      toolUseId: string | null,
      context: { signal: AbortSignal },
    ) => Promise<Record<string, unknown>>
  >;
  timeout?: number;
}

type SDKHooksConfig = {
  [key: string]: SDKHookMatcher[];
};

interface SDKAgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  mcpServers?: (string | Record<string, unknown>)[];
  skills?: string[];
  initialPrompt?: string;
  maxTurns?: number;
  criticalSystemReminder_EXPERIMENTAL?: string;
}

type SDKAgentsConfig = Record<string, SDKAgentDefinition>;

interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

interface McpSSEServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig
  | McpSSEServerConfig
  | Record<string, unknown>;

interface SDKOptions {
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
  model?: string;
  continue?: boolean;
  pathToClaudeCodeExecutable?: string;
  executable?: "node" | "bun" | "deno";
  executableArgs?: string[];
  env?: Record<string, string | undefined>;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  allowDangerouslySkipPermissions?: boolean;
  cwd?: string;
  resume?: string;
  forkSession?: boolean;
  /**
   * Opens the conversation on a caller-chosen UUID instead of an auto-generated
   * one. Legal on its own or alongside `forkSession`; the CLI exits with an
   * error if it is combined with a bare `resume`.
   */
  sessionId?: string;
  abortController?: AbortController;
  additionalDirectories?: string[];
  agents?: SDKAgentsConfig;
  maxTurns?: number;
  systemPrompt?: string | { type: "preset"; preset: "claude_code"; append?: string };
  settingSources?: Array<"user" | "project" | "local">;
  hooks?: SDKHooksConfig;
  mcpServers?: Record<string, McpServerConfig>;
  thinking?:
    | { type: "adaptive" }
    | { type: "enabled"; budgetTokens?: number }
    | { type: "disabled" };
  effort?: ("low" | "medium" | "high" | "xhigh" | "max") | number;
  settings?: string | Record<string, unknown>;
  promptSuggestions?: boolean;
  includePartialMessages?: boolean;
  plugins?: Array<{ type: "local"; path: string; skipMcpDiscovery?: boolean }>;
  canUseTool?: SDKCanUseTool;
  onElicitation?: SDKOnElicitation;
}

/**
 * MCP elicitation — a server asking the user for input (form fields, or a URL
 * to authenticate at). When no callback is supplied the SDK declines every
 * request automatically, so the server's flow fails with nothing shown to the
 * user.
 */
interface SDKElicitationRequest {
  serverName: string;
  message: string;
  mode?: "form" | "url";
  url?: string;
  elicitationId?: string;
  requestedSchema?: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
}

/** MCP `ElicitResult`. `content` is required by the server when accepting a form. */
interface SDKElicitationResult {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

type SDKOnElicitation = (
  request: SDKElicitationRequest,
  options: { signal: AbortSignal },
) => Promise<SDKElicitationResult>;

function isSDKPermissionMode(
  value: unknown,
): value is NonNullable<SDKOptions["permissionMode"]> {
  return isClaudePermissionMode(value);
}

export function buildClaudePermissionModeOptions(
  permissionMode: NonNullable<SDKOptions["permissionMode"]>,
  canUseTool?: SDKCanUseTool,
  toolPolicy?: WorkRunToolPolicy | null,
): Pick<
  SDKOptions,
  | "permissionMode"
  | "allowDangerouslySkipPermissions"
  | "allowedTools"
  | "disallowedTools"
  | "canUseTool"
  | "settings"
> {
  const effectiveAllowedTools = resolveEffectiveAllowedTools(toolPolicy);
  return {
    permissionMode,
    allowedTools: effectiveAllowedTools,
    ...(toolPolicy && toolPolicy.disallowedTools.length > 0
      ? { disallowedTools: [...toolPolicy.disallowedTools] }
      : {}),
    // Build the run-scoped permission snapshot here. buildOptions materializes
    // it to disk because Workflow children do not inherit the inline form.
    settings: {
      permissions: {
        allow: [...effectiveAllowedTools],
        ...(toolPolicy && toolPolicy.disallowedTools.length > 0
          ? { deny: [...toolPolicy.disallowedTools] }
          : {}),
      },
    },
    ...(permissionMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    // Normal bypass calls shadow this callback, but detached agents still
    // forward permission requests that require an application decision.
    ...(canUseTool ? { canUseTool } : {}),
  };
}

/**
 * The Agent SDK ships a Claude Code binary with the same protocol version.
 * Let it select that binary unless the user explicitly configured an override;
 * auto-discovered system CLIs update independently and can break the SDK's
 * bidirectional permission stream.
 */
export function buildClaudeExecutableOptions(
  configuredBinary?: string,
  packagedSdkBinary?: string | null,
): Pick<SDKOptions, "pathToClaudeCodeExecutable"> {
  const candidate = configuredBinary ?? packagedSdkBinary;
  if (!candidate) return {};
  const resolved = resolveCandidate(candidate);
  return resolved ? { pathToClaudeCodeExecutable: resolved } : {};
}

/**
 * Decide whether a run may open its session on an id we chose.
 *
 * The CLI accepts one for a fresh session and for a fork ("a custom ID for the
 * forked session"), but exits with an error when it is combined with a plain
 * resume — measured: `--session-id can only be used with --continue or --resume
 * if --fork-session is also specified`. A resume already knows its id anyway.
 */
export function buildClaudeSessionIdOptions(args: {
  newSessionId?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
}): Pick<SDKOptions, "sessionId"> {
  const { newSessionId, resumeSessionId, forkSession } = args;
  if (!newSessionId) return {};
  if (resumeSessionId && !forkSession) return {};
  return { sessionId: newSessionId };
}

interface SDKCanUseToolOptions {
  signal: AbortSignal;
  suggestions?: unknown[];
  blockedPath?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
  toolUseID: string;
  agentID?: string;
  requestId: string;
  matchedAskRule?: {
    source: string;
    toolName: string;
    ruleContent?: string;
  };
}

type SDKPermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: unknown[];
      toolUseID?: string;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

type SDKCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: SDKCanUseToolOptions,
) => Promise<SDKPermissionResult | null>;

interface SDKMessageContent {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}

/**
 * Reply to the `get_context_usage` control request — the CLI's own `/context`
 * report, structured. This is the meter's live source.
 *
 * Unlike the `/context` message payload below, its categories carry no kind
 * discriminator: deferred rows are flagged, and the two rows that are space
 * rather than content are identified only by name.
 */
export interface SDKContextUsageResponse {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model: string;
  isAutoCompactEnabled?: boolean;
  autoCompactThreshold?: number;
  categories?: { name: string; tokens: number; isDeferred?: boolean }[];
}

/**
 * Context snapshot carried on an assistant message (Agent SDK >= 0.3.233).
 *
 * Per the CLI's own schema this rides *only* the synthetic message that answers
 * `/context` — never an ordinary assistant turn — so it covers the case where a
 * run invokes that command, and `getContextUsage()` covers everything else.
 *
 * `raw_max_tokens` is the *resolved autocompact window* — the model's believed
 * limit, or a smaller compaction-policy window (e.g. the 200K boundary on
 * 1M-window models) — so `percentage` is already measured against the boundary
 * the meter cares about. `total_tokens` is unclamped and may exceed it.
 */
export interface SDKContextUsage {
  model: string;
  total_tokens: number;
  raw_max_tokens: number;
  percentage: number;
  /** Partition of the window; see WorkRunContextUsageCategory for the kinds. */
  categories?: { name: string; tokens: number; kind: string }[];
}

/** Why an assistant turn failed. Also carried on `system:api_retry`. */
type SDKAssistantMessageError =
  | "authentication_failed"
  | "oauth_org_not_allowed"
  | "billing_error"
  | "rate_limit"
  | "overloaded"
  | "invalid_request"
  | "model_not_found"
  | "server_error"
  | "unknown"
  | "max_output_tokens";

interface SDKAssistantMessage {
  type: "assistant";
  uuid: string;
  session_id: string;
  message: { role: "assistant"; content: SDKMessageContent[] };
  parent_tool_use_id: string | null;
  /**
   * Set when the API call behind this turn failed. Without it an auth or
   * billing failure is indistinguishable from the agent saying nothing.
   */
  error?: SDKAssistantMessageError;
  /** Agent SDK >= 0.3.233; absent on older CLI binaries. */
  context_usage?: SDKContextUsage;
}

interface SDKUserMessage {
  type: "user";
  uuid?: string;
  session_id: string;
  message: {
    role: "user";
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        }>;
  };
  parent_tool_use_id: string | null;
  tool_result_meta?: Array<{
    id: string;
    non_execution_kind: string;
    user_feedback?: string;
  }>;
}

interface SDKModelUsage {
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  contextWindow: number;
  maxOutputTokens: number;
}

interface SDKPermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

type FastModeState = "off" | "cooldown" | "on";

/** Why fast mode can't serve. Absent when nothing is blocking it. */
type FastModeDisabledReason =
  | "free"
  | "preference"
  | "extra_usage_disabled"
  | "network_error"
  | "unknown"
  | "not_first_party"
  | "disabled_by_env"
  | "model_not_allowed"
  | "sdk_opt_in_required"
  | "pending";

interface SDKResultBase {
  type: "result";
  uuid: string;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  stop_reason: string | null;
  modelUsage: Record<string, SDKModelUsage>;
  permission_denials: SDKPermissionDenial[];
  fast_mode_state?: FastModeState;
  fast_mode_disabled_reason?: FastModeDisabledReason;
}

interface SDKResultSuccess extends SDKResultBase {
  subtype: "success";
  result: string;
  structured_output?: unknown;
}

interface SDKResultError extends SDKResultBase {
  subtype:
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  errors: string[];
}

type SDKResultMessage = SDKResultSuccess | SDKResultError;

export interface SDKSystemMessage {
  type: "system";
  subtype:
    | "init"
    | "compact_boundary"
    | "api_retry"
    | "status"
    | "plugin_install"
    | "task_started"
    | "task_progress"
    | "task_updated"
    | "task_notification"
    | "model_refusal_fallback"
    | "model_refusal_no_fallback"
    | "permission_denied"
    | "informational"
    | "notification";
  uuid: string;
  session_id: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  permissionMode?: string;
  agents?: string[];
  apiKeySource?: string;
  betas?: string[];
  claude_code_version?: string;
  mcp_servers?: { name: string; status: string }[];
  slash_commands?: string[];
  output_style?: string;
  skills?: string[];
  // subtype: "init"
  plugins?: { name: string; path: string }[];
  fast_mode_state?: FastModeState;
  fast_mode_disabled_reason?: FastModeDisabledReason;
  // subtype: "compact_boundary"
  compact_metadata?: {
    trigger: "manual" | "auto";
    pre_tokens: number;
    post_tokens?: number;
    duration_ms?: number;
  };
  // subtype: "api_retry"
  attempt?: number;
  max_retries?: number;
  retry_delay_ms?: number;
  error_status?: number | null;
  // subtype: "plugin_install"
  status?: "started" | "installed" | "failed" | "completed" | "stopped";
  name?: string;
  /**
   * Two shapes behind one field name: free-form prose on "plugin_install", and
   * an SDKAssistantMessageError code on "api_retry".
   */
  error?: string;
  // subtypes: "task_started" | "task_progress" | "task_updated" | "task_notification"
  task_id?: string;
  tool_use_id?: string;
  description?: string;
  subagent_type?: string;
  task_type?: string;
  last_tool_name?: string;
  summary?: string;
  output_file?: string;
  skip_transcript?: boolean;
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
  // subtype: "task_updated" — a wire-safe subset of the changed task fields
  patch?: {
    status?: "pending" | "running" | "completed" | "failed" | "killed" | "paused";
    description?: string;
    end_time?: number;
    error?: string;
    is_backgrounded?: boolean;
  };
  // subtypes: "model_refusal_fallback" | "model_refusal_no_fallback"
  original_model?: string;
  fallback_model?: string;
  api_refusal_category?: string | null;
  api_refusal_explanation?: string | null;
  // subtypes: "model_refusal_*" | "informational" | "notification"
  content?: string;
  // subtype: "permission_denied"
  tool_name?: string;
  decision_reason?: string;
  agent_id?: string;
  message?: string;
  // subtype: "informational"
  level?: "info" | "notice" | "suggestion" | "warning";
  prevent_continuation?: boolean;
  // subtype: "notification"
  text?: string;
  priority?: "low" | "medium" | "high" | "immediate";
}

interface SDKRateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage";
  utilization?: number;
}

interface SDKRateLimitEvent {
  type: "rate_limit_event";
  rate_limit_info: SDKRateLimitInfo;
  uuid: string;
  session_id: string;
}

interface SDKRawStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; [key: string]: unknown };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    [key: string]: unknown;
  };
  message?: { id?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface SDKPartialAssistantMessage {
  type: "stream_event";
  event: SDKRawStreamEvent;
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
}

type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKRateLimitEvent
  | SDKPartialAssistantMessage
  | { type: string; session_id?: string; [key: string]: unknown };

interface SDKModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsFastMode?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: ("low" | "medium" | "high" | "xhigh" | "max")[];
  supportsAutoMode?: boolean;
  supportsAdaptiveThinking?: boolean;
}

interface SDKSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
}

interface SDKInitializationResult {
  commands: SDKSlashCommand[];
  output_style: string;
  available_output_styles: string[];
  models: SDKModelInfo[];
  account: { email?: string; organization?: string };
}

/** Subset of the SDK's SDKSessionInfo we read for the auto-title. */
interface SDKSessionInfoLite {
  sessionId: string;
  /** Display title: customTitle || aiTitle || lastPrompt || firstPrompt. */
  summary: string;
  /** User-set title via /rename. */
  customTitle?: string;
  /** First meaningful user prompt — used to detect "no AI title yet". */
  firstPrompt?: string;
}

interface SDKQuery extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  /** Forcefully ends the query and terminates the CLI subprocess. */
  close(): void;
  rewindFiles(userMessageUuid: string, options?: { dryRun?: boolean }): Promise<unknown>;
  getContextUsage(): Promise<SDKContextUsageResponse>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  initializationResult(): Promise<SDKInitializationResult>;
  supportedCommands(): Promise<SDKSlashCommand[]>;
  supportedModels(): Promise<SDKModelInfo[]>;
  mcpServerStatus(): Promise<unknown[]>;
  accountInfo(): Promise<{
    email?: string;
    organization?: string;
    subscriptionType?: string;
    apiKeySource?: string;
    tokenSource?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Per-run session state (handed back to Core as opaque `session`)
// ─────────────────────────────────────────────────────────────

/**
 * taskId → the tool_use_id that spawned it, remembered from `task_started`
 * because later task phases don't all repeat it.
 */
export type ClaudeTaskIndex = Map<
  string,
  { toolUseId?: string; description?: string; subagentType?: string }
>;

interface ClaudeSession {
  runId: string;
  options: SDKOptions;
  abortController: AbortController;
  /** On-disk flag-settings snapshot inherited by dynamic Workflow agents. */
  runtimeSettingsPath?: string;
  /** Whether this run asked for fast mode — the CLI only reports on it. */
  fastModeRequested: boolean;
  /** Mutable: set during streaming. */
  state: {
    sessionId?: string;
    lastStopReason?: string | null;
    lastUsage?: WorkRunUsage;
    terminalToolNonExecutionKind?: string;
    hasAssistantContent: boolean;
    lastFastModeState?: FastModeState;
    lastAssistantError?: string;
    sawRateLimitNotice?: boolean;
  };
  /** Per-run tool-call correlation index (toolCallId → toolName/input). */
  toolCallIndex: Map<string, { toolName: string; input?: unknown; startedAt?: number }>;
  /**
   * Per-run task correlation index (taskId → spawning tool_use_id).
   *
   * `system:task_updated` carries only `task_id` — no `tool_use_id` — so the
   * anchor has to be remembered from `task_started` for later phases to attach
   * to the right tool call.
   */
  taskIndex: ClaudeTaskIndex;
  /** Per-(runId, blockIndex) streaming text buffers. */
  partialTextBuffers: Map<string, string>;
  /** Per-(runId, blockIndex) streaming thinking buffers. */
  partialThinkingBuffers: Map<string, string>;
  /** SDK query — created lazily in executePrompt because the prompt is supplied there. */
  query?: SDKQuery;
  /** True for start/fork (a fresh run that owns its title), false for continue. */
  isInitial: boolean;
}

const { info: logInfo, warn: logWarn, error: logError } = createLogger("[ClaudeDriver]");

/**
 * Wire name of the subagent tool.
 *
 * The CLI names this tool in two layers and they do not agree: the registry
 * calls it `Task` (that is what system/init's tool list reports and what
 * permission rules and DEFAULT_ALLOWED_TOOLS match), while the `tool_use`
 * blocks it emits name it `Agent`. Event mapping only ever sees wire names, so
 * matching `Task` here would never fire.
 */
const SUBAGENT_TOOL_NAME = "Agent";

/**
 * Flatten an Agent tool_result into display text.
 *
 * The SDK returns the subagent's result as an array of content blocks —
 * `[{type:"text",text:"…report…"},{type:"text",text:"agentId: … subagent_tokens: …"}]`
 * — where the last block is continuation bookkeeping, not report. Persisting
 * that raw JSON made the panel/tab show `[{"type":"text"…` verbatim. Text
 * blocks are joined for display, the bookkeeping block is dropped, and the
 * agentId it carries is extracted on the way out.
 */
export function normalizeSubagentOutput(output: unknown): {
  text?: string;
  agentId?: string;
} {
  const texts: string[] = Array.isArray(output)
    ? output.flatMap((block) => {
        const b = block as Record<string, unknown> | null;
        return b && b.type === "text" && typeof b.text === "string" ? [b.text] : [];
      })
    : typeof output === "string"
      ? [output]
      : output !== undefined && output !== null
        ? [safeJson(output)]
        : [];

  let agentId: string | undefined;
  const visible: string[] = [];
  for (const text of texts) {
    const agentIdMatch = text.match(AGENT_ID_IN_RESULT);
    if (agentIdMatch) agentId = agentIdMatch[1];
    // A block that IS the bookkeeping (starts with "agentId:") is dropped;
    // a report that merely mentions an agentId inline stays visible.
    if (/^\s*agentId:/i.test(text)) continue;
    visible.push(text);
  }
  return { text: visible.join("\n\n").trim() || undefined, agentId };
}

/**
 * The SDK's launch acknowledgement for a backgrounded agent, as prose —
 * there is no structured marker on the tool_result for this (checked against
 * the tool_result content blocks the SDK emits), so this string IS the
 * contract. SDK-coupled: if the wording changes, background agents degrade to
 * the old behavior (ack read as a report / early green check) rather than
 * losing data — the pinned test on this constant is the tripwire.
 */
export const BACKGROUND_LAUNCH_ACK = /^Async agent launched\b/i;

/**
 * Build the terminal `subagent` event for a finished subagent tool call.
 * Shared by the `user` tool_result path (what the SDK actually sends) and the
 * bare `tool_result` fallback in the default branch.
 */
export function buildSubagentCompletionEvent(args: {
  input?: unknown;
  output?: unknown;
  error?: string;
  toolUseId?: string;
  ts: number;
}): WorkRunEvent {
  const { input, output, error, toolUseId, ts } = args;
  const taskInput = input as Record<string, unknown> | undefined;
  const subagentType = (taskInput?.subagent_type as string) || "general-purpose";
  const { text, agentId } = normalizeSubagentOutput(output);

  // A backgrounded agent's tool_result is only the LAUNCH ACK — the agent is
  // still working, and its real outcome arrives later as a task_notification.
  // Marking this "completed" showed a green check the moment the agent
  // spawned, with the ack persisted as its "report". The structured
  // run_in_background input wins whenever the model supplied it; the prose
  // match is only the fallback for the (observed, common) case where the CLI
  // backgrounds the agent without that flag ever appearing in the input.
  const isLaunchAck =
    !error &&
    (taskInput?.run_in_background === true ||
      BACKGROUND_LAUNCH_ACK.test(text ?? ""));
  if (isLaunchAck) {
    return {
      type: "subagent",
      phase: "running",
      agentType: subagentType,
      agentId,
      parentToolUseId: toolUseId || undefined,
      ts,
      metadata: { toolCallId: toolUseId || undefined },
    };
  }

  return {
    type: "subagent",
    phase: error ? "failed" : "completed",
    agentType: subagentType,
    agentId,
    parentToolUseId: toolUseId || undefined,
    result: text,
    error,
    ts,
    metadata: { toolCallId: toolUseId || undefined },
  };
}

type ApprovalRequester = (request: ToolApprovalRequest) => Promise<ToolApprovalResponse>;

interface ClaudePermissionBridgeOptions {
  runId: string;
  allowedTools: Set<string>;
  bypassMode: boolean;
  /**
   * True when the run's tool policy *replaced* the default allowlist rather
   * than trimming it — a mode that ships its own tool set (chat). MCP tools
   * then lose their blanket trust: a mode that removed Write must not get it
   * back through a filesystem MCP server the space happens to have attached.
   */
  restrictedToolset?: boolean;
  requestApproval?: ApprovalRequester;
  cancelApproval?: (requestId: string) => void;
}

interface PermissionDecision {
  allowed: boolean;
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: unknown[];
  reason?: string;
}

/**
 * Build the SDK permission callback used by both foreground and background
 * agents. Do not mirror this through an in-process PreToolUse hook: dynamic
 * Workflow children inherit the hook registration but cannot invoke the
 * parent's callback, so their tool calls are cancelled before permission rules
 * or canUseTool can settle them.
 */
export function createClaudePermissionBridge({
  runId,
  allowedTools,
  bypassMode,
  restrictedToolset = false,
  requestApproval = requestToolApproval,
  cancelApproval = cancelPendingRequest,
}: ClaudePermissionBridgeOptions): {
  canUseTool: SDKCanUseTool;
} {
  async function decide(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: { signal: AbortSignal; requestId?: string },
  ): Promise<PermissionDecision> {
    const isAskUser = toolName === "AskUserQuestion";

    // AskUserQuestion is an interaction, not a permission gate, so it must
    // still reach the renderer even in bypass mode.
    // The `mcp__` shortcut is the pre-approval an MCP server earns by being
    // configured at all — but only while the run is on the default toolset.
    // Under a replacement allowlist it falls through to the approval dialog,
    // matching the copilot driver's pre-tool hook.
    const mcpTrusted = !restrictedToolset && toolName.startsWith("mcp__");
    if ((bypassMode && !isAskUser) || allowedTools.has(toolName) || mcpTrusted) {
      return { allowed: true, updatedInput: toolInput };
    }

    if (context.signal.aborted) {
      return { allowed: false, reason: "Request aborted" };
    }

    const requestId =
      context.requestId || `${runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const req: ToolApprovalRequest = {
      requestId,
      runId,
      toolName,
      toolInput,
      kind: isAskUser ? "ask_user" : "tool_approval",
      timestamp: Date.now(),
    };

    if (isAskUser) {
      const questions = toolInput.questions as
        | Array<{
            question?: string;
            options?: Array<{ label: string; description?: string }>;
            multiSelect?: boolean;
          }>
        | undefined;
      if (questions && questions.length > 0) {
        const first = questions[0];
        req.question = first.question;
        req.options = first.options;
        req.multiSelect = first.multiSelect;
      }
    }

    let resolveAbort: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
      resolveAbort = () => resolve(null);
      context.signal.addEventListener("abort", resolveAbort, { once: true });
    });

    let response: ToolApprovalResponse | null;
    try {
      response = await Promise.race([requestApproval(req), aborted]);
    } finally {
      if (resolveAbort) context.signal.removeEventListener("abort", resolveAbort);
    }

    if (!response) {
      // The SDK may close a control stream while a permission request is
      // parked (for example during background-agent handoff). Resolve the
      // broker entry as well so the renderer never retains a ghost dialog.
      cancelApproval(requestId);
      return { allowed: false, reason: "Permission request aborted" };
    }

    if (!response.approved) {
      return { allowed: false, reason: "User denied permission" };
    }

    if (toolName === "ExitPlanMode") {
      return {
        allowed: true,
        updatedInput: toolInput,
        // Updating the persisted provider config only affects future queries.
        // Move the currently running Claude SDK session out of plan mode too,
        // so the implementation phase inherits the UI's "Edit" selection.
        updatedPermissions: [
          {
            type: "setMode",
            mode: "acceptEdits",
            destination: "session",
          },
        ],
      };
    }

    if (isAskUser && response.answer !== undefined) {
      const askedQuestions = (toolInput.questions ?? []) as Array<{ question?: string }>;
      const answers: Record<string, string> = {};
      for (const question of askedQuestions) {
        if (question.question) answers[question.question] = response.answer;
      }
      return {
        allowed: true,
        updatedInput: { questions: askedQuestions, answers },
      };
    }

    return { allowed: true, updatedInput: toolInput };
  }

  const canUseTool: SDKCanUseTool = async (toolName, toolInput, options) => {
    const decision = await decide(toolName, toolInput, {
      signal: options.signal,
      requestId: options.requestId,
    });
    if (!decision.allowed) {
      return {
        behavior: "deny",
        message: decision.reason || "Permission denied",
        toolUseID: options.toolUseID,
      };
    }
    return {
      behavior: "allow",
      updatedInput: decision.updatedInput ?? toolInput,
      ...(decision.updatedPermissions
        ? { updatedPermissions: decision.updatedPermissions }
        : {}),
      toolUseID: options.toolUseID,
    };
  };

  return { canUseTool };
}

/** Narrow arbitrary JSON to the value types MCP allows in an elicitation result. */
function coerceElicitationContent(
  parsed: unknown,
): Record<string, string | number | boolean | string[]> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      out[key] = value as string[];
    }
    // Anything else (nested objects, nulls) is not expressible — drop it rather
    // than sending a payload the server will reject wholesale.
  }
  return out;
}

/**
 * Bridge MCP elicitation requests to the same approval broker that already
 * backs tool approvals and AskUserQuestion.
 *
 * Without this the SDK auto-declines every elicitation, so an MCP server that
 * needs a form filled or an auth URL visited fails with nothing shown to the
 * user — the failure mode this exists to remove.
 */
export function createClaudeElicitationHandler({
  runId,
  requestApproval = requestToolApproval,
  cancelApproval = cancelPendingRequest,
}: {
  runId: string;
  requestApproval?: ApprovalRequester;
  cancelApproval?: (requestId: string) => void;
}): SDKOnElicitation {
  return async (request, options) => {
    if (options.signal.aborted) return { action: "cancel" };

    const requestId = `${runId}-elicit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mode = request.mode ?? (request.url ? "url" : "form");
    const req: ToolApprovalRequest = {
      requestId,
      runId,
      // The dialog's title slot; the server name is the most identifying label.
      toolName: request.displayName || request.serverName,
      kind: "elicitation",
      header: request.title,
      question: request.message,
      description: request.description,
      serverName: request.serverName,
      elicitationMode: mode,
      url: request.url,
      requestedSchema: request.requestedSchema,
      timestamp: Date.now(),
    };

    let resolveAbort: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
      resolveAbort = () => resolve(null);
      options.signal.addEventListener("abort", resolveAbort, { once: true });
    });

    let response: ToolApprovalResponse | null;
    try {
      response = await Promise.race([requestApproval(req), aborted]);
    } finally {
      if (resolveAbort) options.signal.removeEventListener("abort", resolveAbort);
    }

    if (!response) {
      // Settle the broker entry too, so the renderer never keeps a ghost dialog.
      cancelApproval(requestId);
      return { action: "cancel" };
    }
    if (!response.approved) return { action: "decline" };

    if (mode === "url") return { action: "accept" };

    const content = response.answer
      ? coerceElicitationContent(safeParseJson(response.answer))
      : null;
    if (!content) {
      // Accepting with content we know is wrong turns into an opaque server-side
      // validation error; declining reports the real problem — we could not
      // collect the fields.
      logWarn("Elicitation accepted without usable form content; declining");
      return { action: "decline" };
    }
    return { action: "accept", content };
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Why an assistant turn failed, in words a user can act on, and how loudly to
 * say it. `warn` is for what the CLI retries on its own; `error` is for what
 * stays broken until someone does something about it.
 */
const ASSISTANT_ERRORS: Record<
  SDKAssistantMessageError,
  { text: string; level: "warn" | "error" }
> = {
  authentication_failed: { text: "authentication failed — sign in again", level: "error" },
  oauth_org_not_allowed: { text: "this organization does not allow this login", level: "error" },
  billing_error: { text: "billing problem on this account", level: "error" },
  invalid_request: { text: "the request was rejected as invalid", level: "error" },
  model_not_found: { text: "the selected model is unavailable", level: "error" },
  unknown: { text: "the request failed", level: "error" },
  rate_limit: { text: "rate limited", level: "warn" },
  overloaded: { text: "the API is overloaded", level: "warn" },
  server_error: { text: "the API returned a server error", level: "warn" },
  max_output_tokens: { text: "the response hit the output token limit", level: "warn" },
};

function describeAssistantError(code: string | undefined): { text: string; level: "warn" | "error" } | null {
  if (!code) return null;
  return ASSISTANT_ERRORS[code as SDKAssistantMessageError] ?? null;
}

/**
 * Report an assistant turn that failed.
 *
 * The CLI still emits the assistant message, just with no content and this flag
 * set, so an auth or billing failure otherwise reads as the agent going quiet.
 * Repeats of the same code are collapsed — a run can retry an overload many
 * times, and one line per attempt buries the rest of the transcript.
 */
export function buildAssistantErrorEvent(
  args: { error?: string; lastError?: string; sawRateLimitNotice?: boolean },
  ts: number,
): WorkRunEvent | null {
  const { error, lastError, sawRateLimitNotice } = args;
  if (!error || error === lastError) return null;
  // `rate_limit_event` has its own line, carrying the scope and the reset time
  // this one cannot. Repeating it here would say strictly less, twice.
  if (error === "rate_limit" && sawRateLimitNotice) return null;
  const described = describeAssistantError(error);
  return {
    type: "log",
    message: `[api] ${described?.text ?? error}`,
    level: described?.level ?? "error",
    ts,
    metadata: { source: "assistant_error", error },
  };
}

/**
 * Why the CLI would not serve fast mode, in words a user can act on.
 *
 * `sdk_opt_in_required` is absent on purpose: it means nothing asked for fast
 * mode, which is not a failure and never reaches the reporter below.
 */
const FAST_MODE_REASONS: Record<FastModeDisabledReason, string> = {
  extra_usage_disabled: "extra usage is turned off for this account",
  free: "not available on the free plan",
  model_not_allowed: "the selected model does not support it",
  not_first_party: "not available on this API provider",
  disabled_by_env: "disabled by an environment variable",
  preference: "turned off in Claude Code settings",
  network_error: "the availability check failed",
  pending: "the availability check has not finished",
  sdk_opt_in_required: "the request did not opt in",
  unknown: "the CLI did not say why",
};

/**
 * Report fast mode failing to engage.
 *
 * The CLI accepts the request and then silently serves at standard speed, so
 * without this the button reads "on" for a whole run that never ran fast. Only
 * speaks when the run actually asked for it, and only when the state changes,
 * since init and result both carry it.
 */
export function buildFastModeEvent(
  args: {
    requested: boolean;
    state?: FastModeState;
    reason?: FastModeDisabledReason;
    lastState?: FastModeState;
  },
  ts: number,
): WorkRunEvent | null {
  const { requested, state, reason, lastState } = args;
  if (!requested || !state || state === lastState) return null;
  if (state === "on") {
    return {
      type: "log",
      message: "[fast-mode] active",
      level: "info",
      ts,
      metadata: { source: "fast_mode", state },
    };
  }
  const detail =
    state === "cooldown"
      ? "paused after a rate limit"
      : reason
        ? FAST_MODE_REASONS[reason]
        : undefined;
  return {
    type: "log",
    message: `[fast-mode] requested but not active${detail ? ` — ${detail}` : ""}`,
    level: "warn",
    ts,
    metadata: { source: "fast_mode", state, reason },
  };
}

/**
 * The two category names that are space rather than content.
 *
 * Matched by name because the control reply carries no kind discriminator. A
 * rename upstream degrades gracefully — the row keeps its real tokens and just
 * renders as an ordinary category instead of as empty space.
 */
const FREE_CATEGORY_NAME = "free space";
const BUFFER_CATEGORY_NAME = "autocompact buffer";

/**
 * Map the `get_context_usage` control reply to the renderer's meter event.
 *
 * `maxTokens` is the window `percentage` was computed against, so the meter
 * measures the same thing the CLI's `/context` report does.
 */
export function mapContextUsageResponse(
  response: SDKContextUsageResponse | null | undefined,
  ts: number,
): WorkRunEvent | null {
  if (!response || !(response.maxTokens > 0)) return null;
  const categories = response.categories
    ?.filter((category) => category.tokens > 0)
    .map((category) => {
      const name = category.name.trim().toLowerCase();
      const kind: WorkRunContextUsageCategory["kind"] = category.isDeferred
        ? "deferred"
        : name === FREE_CATEGORY_NAME
          ? "free"
          : name === BUFFER_CATEGORY_NAME
            ? "buffer"
            : "used";
      return { name: category.name, tokens: category.tokens, kind };
    });
  return {
    type: "context_usage",
    totalTokens: response.totalTokens,
    maxTokens: response.maxTokens,
    percentage: response.percentage,
    model: response.model,
    ...(response.isAutoCompactEnabled !== undefined
      ? { isAutoCompactEnabled: response.isAutoCompactEnabled }
      : {}),
    ...(response.autoCompactThreshold !== undefined
      ? { autoCompactThreshold: response.autoCompactThreshold }
      : {}),
    ...(categories?.length ? { categories } : {}),
    ts,
  };
}

/**
 * Map the `/context` message snapshot to the renderer's meter event.
 *
 * Returns null when there is nothing meaningful to show: a subagent message
 * (its window is not the main conversation's), an older CLI that sends no
 * snapshot, or a snapshot with no window to measure against. `total_tokens` is
 * passed through unclamped — it can exceed the window, and the meter clamps.
 */
export function buildContextUsageEvent(
  msg: { context_usage?: SDKContextUsage; parent_tool_use_id: string | null },
  ts: number,
): WorkRunEvent | null {
  const ctx = msg.context_usage;
  if (!ctx || msg.parent_tool_use_id || !(ctx.raw_max_tokens > 0)) return null;
  // The kinds come off a subprocess, so unknown ones are dropped rather than
  // widening the renderer's union — a row it can't classify has no place to go.
  const categories = ctx.categories
    ?.filter(
      (c): c is WorkRunContextUsageCategory =>
        c.tokens > 0 &&
        (c.kind === "used" || c.kind === "free" || c.kind === "buffer" || c.kind === "deferred"),
    )
    .map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind }));
  return {
    type: "context_usage",
    totalTokens: ctx.total_tokens,
    maxTokens: ctx.raw_max_tokens,
    percentage: ctx.percentage,
    model: ctx.model,
    ...(categories?.length ? { categories } : {}),
    ts,
  };
}

/**
 * Map a `system:task_*` message to a WorkRunTaskEvent.
 *
 * The CLI runs long tool calls as tasks: a Bash command that outlives the
 * foreground timeout is backgrounded, and every Agent call is a task. The
 * spawning tool call returns immediately, so the task's real outcome arrives
 * later — sometimes after the `result` message — via `task_notification`.
 *
 * Only `task_started` and `task_notification` carry `tool_use_id`; the rest are
 * resolved through the session's taskIndex, which `task_started` populates.
 * Returns null when the anchor is unknown (a task whose start was never seen),
 * because an event with no tool call to attach to has nowhere to land.
 */
export function mapTaskMessage(
  msg: SDKSystemMessage,
  taskIndex: ClaudeTaskIndex,
  ts: number,
): WorkRunEvent | null {
  const taskId = msg.task_id;
  if (!taskId) return null;

  if (msg.subtype === "task_started") {
    taskIndex.set(taskId, {
      toolUseId: msg.tool_use_id,
      description: msg.description,
      subagentType: msg.subagent_type,
    });
  }

  const known = taskIndex.get(taskId);
  const toolCallId = msg.tool_use_id ?? known?.toolUseId;
  if (!toolCallId) return null;

  const base = {
    type: "task" as const,
    taskId,
    toolCallId,
    description: msg.description ?? known?.description,
    subagentType: msg.subagent_type ?? known?.subagentType,
    skipTranscript: msg.skip_transcript,
    ts,
  };

  const usage = msg.usage
    ? {
        totalTokens: msg.usage.total_tokens,
        toolUses: msg.usage.tool_uses,
        durationMs: msg.usage.duration_ms,
      }
    : undefined;

  switch (msg.subtype) {
    case "task_started":
      return { ...base, phase: "started", status: "running", taskType: msg.task_type };

    case "task_progress":
      return {
        ...base,
        phase: "progress",
        status: "running",
        usage,
        lastToolName: msg.last_tool_name,
        summary: msg.summary,
      };

    case "task_updated":
      return {
        ...base,
        phase: "updated",
        status: msg.patch?.status,
        description: msg.patch?.description ?? base.description,
        error: msg.patch?.error,
      };

    case "task_notification": {
      // Terminal for this task — drop the anchor so a later message carrying a
      // recycled id cannot reattach to a tool call that is already settled.
      taskIndex.delete(taskId);
      const raw = msg.status;
      const status =
        raw === "completed" || raw === "failed" || raw === "stopped" ? raw : undefined;
      return {
        ...base,
        phase: "completed",
        status,
        summary: msg.summary,
        outputFile: msg.output_file,
        usage,
        error: status === "failed" ? msg.summary : undefined,
      };
    }
  }

  return null;
}

/**
 * Dynamic Workflow agents run in a separate runtime and Claude Code 2.1.218
 * does not propagate inline SDK flag settings to them. A settings file path is
 * propagated, so materialize the per-run snapshot instead of mutating user or
 * project settings.
 */
export function writeClaudeRuntimeSettings(
  settings: Record<string, unknown>,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-claude-settings-"));
  try {
    fs.chmodSync(dir, 0o700);
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(settings), {
      encoding: "utf8",
      mode: 0o600,
    });
    return settingsPath;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export function removeClaudeRuntimeSettings(settingsPath?: string): void {
  if (!settingsPath) return;
  const settingsDir = path.dirname(settingsPath);
  if (
    path.dirname(settingsDir) !== os.tmpdir() ||
    !path.basename(settingsDir).startsWith("mains-claude-settings-") ||
    path.basename(settingsPath) !== "settings.json"
  ) {
    logWarn("Refusing to remove an unrecognized runtime settings path");
    return;
  }
  try {
    fs.rmSync(settingsDir, { recursive: true, force: true });
  } catch (error) {
    logWarn(
      "Failed to remove runtime settings snapshot:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Event mapping: SDKMessage → WorkRunEvent[]
//
// Module-scope (not factory-scope) on purpose: it reads only the per-run
// session object and module helpers, and being importable is what makes the
// subagent event sequence testable.
// ─────────────────────────────────────────────────────────────

export function mapSDKMessage(
  msg: SDKMessage,
  cs: ClaudeSession,
): WorkRunEvent[] {
  const events: WorkRunEvent[] = [];
  const ts = Date.now();

  switch (msg.type) {
    case "assistant": {
      const assistantMsg = msg as SDKAssistantMessage;
      const isFromSubagent = !!assistantMsg.parent_tool_use_id;

      const errorEvent = buildAssistantErrorEvent(
        {
          error: assistantMsg.error,
          lastError: cs.state.lastAssistantError,
          sawRateLimitNotice: cs.state.sawRateLimitNotice,
        },
        ts,
      );
      if (errorEvent) events.push(errorEvent);
      // A turn that came back clean ends the episode, so the next failure of the
      // same kind is reported again instead of being read as a repeat.
      cs.state.lastAssistantError = assistantMsg.error;

      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === "text" && block.text) {
            events.push({
              type: "artifact",
              kind: "report",
              content: block.text,
              metadata: {
                source: "assistant.message",
                isFromSubagent,
                parentToolUseId: assistantMsg.parent_tool_use_id || undefined,
              },
            });
          }

          if (block.type === "tool_use" && block.name) {
            const toolCallId = block.id || `${block.name}-${ts}`;
            cs.toolCallIndex.set(toolCallId, {
              toolName: block.name,
              input: block.input,
              startedAt: ts,
            });
            events.push({
              type: "tool_call",
              toolName: block.name,
              input: block.input as Record<string, unknown> | undefined,
              startedAt: ts,
              metadata: {
                phase: "start",
                toolCallId,
                rawType: msg.type,
                parentToolUseId: assistantMsg.parent_tool_use_id || undefined,
                isFromSubagent,
              },
            });

            if (block.name === SUBAGENT_TOOL_NAME) {
              const taskInput = block.input as Record<string, unknown> | undefined;
              const subagentType =
                (taskInput?.subagent_type as string) || "general-purpose";
              const subagentPrompt = taskInput?.prompt as string | undefined;

              events.push({
                type: "subagent",
                phase: "invoked",
                agentType: subagentType,
                parentToolUseId: toolCallId,
                prompt: subagentPrompt,
                ts,
                metadata: {
                  toolCallId,
                  description: taskInput?.description as string | undefined,
                  model: taskInput?.model as string | undefined,
                  runInBackground: taskInput?.run_in_background as boolean | undefined,
                },
              });
            }
          }
        }
      }
      break;
    }

    case "user": {
      const userMsg = msg as SDKUserMessage;
      const content = userMsg.message?.content;

      let userContent: string | undefined;
      if (typeof content === "string") {
        userContent = content;
      } else if (Array.isArray(content)) {
        // Tool results arrive as `tool_result` content blocks inside user
        // messages. This is the ONLY completion signal for subagent tool
        // calls — they never trigger the PostToolUse hook — so without this
        // they stay `running` in the DB until the run-end sweep. Emit a
        // `complete` event per block so the status flips running → done.
        const isFromSubagent = !!(userMsg as any).parent_tool_use_id;
        for (const block of content) {
          if (block?.type !== "tool_result") continue;
          const toolUseId: string = block.tool_use_id || "";
          const prev = toolUseId ? cs.toolCallIndex.get(toolUseId) : undefined;
          const output = block.content;
          const error = block.is_error ? safeJson(output) : undefined;
          const resultMeta = userMsg.tool_result_meta?.find((meta) => meta.id === toolUseId);
          const nonExecutionKind = resultMeta?.non_execution_kind;
          if (nonExecutionKind) {
            cs.state.terminalToolNonExecutionKind = nonExecutionKind;
          } else if (!block.is_error) {
            delete cs.state.terminalToolNonExecutionKind;
          }
          if (toolUseId) cs.toolCallIndex.delete(toolUseId);
          events.push({
            type: "tool_call",
            toolName: prev?.toolName || "unknown",
            input: prev?.input as Record<string, unknown> | undefined,
            output,
            error,
            endedAt: ts,
            metadata: {
              phase: "complete",
              toolCallId: toolUseId || undefined,
              rawType: msg.type,
              isFromSubagent,
              parentToolUseId: userMsg.parent_tool_use_id || undefined,
              nonExecutionKind,
              userFeedback: resultMeta?.user_feedback,
            },
          });

          // A subagent's result arrives here — as a tool_result block inside a
          // user message — never as a bare `tool_result` message. The default
          // branch below also builds this event, but for a message shape the
          // SDK does not send, so this is the path that actually fires.
          if (prev?.toolName === SUBAGENT_TOOL_NAME) {
            events.push(
              buildSubagentCompletionEvent({
                input: prev.input,
                output,
                error,
                toolUseId,
                ts,
              }),
            );
          }
        }
        userContent = content.map((c) => c.text || "").filter(Boolean).join("\n");
      }

      if (userContent && userContent.trim().length > 0) {
        const isContinuationSummary = userContent.includes("continued from a previous conversation");
        if (isContinuationSummary) {
          events.push({
            type: "artifact",
            kind: "report",
            content: userContent,
            metadata: { source: "continuation-summary" },
          });
        } else {
          events.push({
            type: "log",
            message: userContent,
            level: "sdk-user",
            ts,
          });
        }
      }
      break;
    }

    case "system": {
      const systemMsg = msg as SDKSystemMessage;
      if (systemMsg.subtype === "init") {
        const plugins = systemMsg.plugins ?? [];
        const pluginPart = plugins.length
          ? ` · ${plugins.length} plugin${plugins.length === 1 ? "" : "s"}: ${plugins.map((p) => p.name).join(", ")}`
          : "";
        events.push({
          type: "log",
          message: `[system] Session initialized with model: ${systemMsg.model || "unknown"}${pluginPart}`,
          level: "start",
          ts,
          ...(plugins.length ? { metadata: { source: "init", plugins } } : {}),
        });
        const fastModeEvent = buildFastModeEvent(
          {
            requested: cs.fastModeRequested,
            state: systemMsg.fast_mode_state,
            reason: systemMsg.fast_mode_disabled_reason,
            lastState: cs.state.lastFastModeState,
          },
          ts,
        );
        if (fastModeEvent) {
          cs.state.lastFastModeState = systemMsg.fast_mode_state;
          events.push(fastModeEvent);
        }
      } else if (systemMsg.subtype === "compact_boundary") {
        const meta = systemMsg.compact_metadata;
        const trigger = meta?.trigger ?? "auto";
        const pre = meta?.pre_tokens;
        const post = meta?.post_tokens;
        const tokenPart =
          typeof pre === "number"
            ? ` (${pre.toLocaleString()}${typeof post === "number" ? ` → ${post.toLocaleString()}` : ""} tokens)`
            : "";
        events.push({
          type: "log",
          message: `[context] Conversation compacted${tokenPart} — ${trigger} trigger`,
          level: "info",
          ts,
          metadata: { source: "compact_boundary", ...meta },
        });
      } else if (systemMsg.subtype === "api_retry") {
        const attempt = systemMsg.attempt;
        const maxRetries = systemMsg.max_retries;
        const delayMs = systemMsg.retry_delay_ms;
        const attemptPart =
          typeof attempt === "number" && typeof maxRetries === "number"
            ? ` (${attempt}/${maxRetries})`
            : "";
        const delayPart =
          typeof delayMs === "number" ? ` — retrying in ${Math.round(delayMs / 1000)}s` : "";
        const statusPart =
          systemMsg.error_status != null ? ` [HTTP ${systemMsg.error_status}]` : "";
        // On this subtype `error` is a failure code, not prose — saying which
        // one is the difference between "retrying" and "retrying, and here is
        // why it will keep failing".
        const described = describeAssistantError(systemMsg.error);
        const reasonPart = described ? `: ${described.text}` : "";
        events.push({
          type: "log",
          message: `[api] Request failed${reasonPart}${statusPart}${attemptPart}${delayPart}`,
          level: "warn",
          ts,
          metadata: {
            source: "api_retry",
            attempt,
            maxRetries,
            retryDelayMs: delayMs,
            errorStatus: systemMsg.error_status,
            error: systemMsg.error,
          },
        });
      } else if (systemMsg.subtype === "plugin_install") {
        const status = systemMsg.status;
        const namePart = systemMsg.name ? ` ${systemMsg.name}` : "";
        const errorPart = systemMsg.error ? `: ${systemMsg.error}` : "";
        // started/completed bracket the whole sync; installed/failed are per-plugin.
        events.push({
          type: "log",
          message: `[plugin] ${status ?? "install"}${namePart}${errorPart}`,
          level: status === "failed" ? "error" : "info",
          ts,
          metadata: {
            source: "plugin_install",
            status,
            name: systemMsg.name,
            error: systemMsg.error,
          },
        });
      } else if (
        systemMsg.subtype === "task_started" ||
        systemMsg.subtype === "task_progress" ||
        systemMsg.subtype === "task_updated" ||
        systemMsg.subtype === "task_notification"
      ) {
        const taskEvent = mapTaskMessage(systemMsg, cs.taskIndex, ts);
        if (taskEvent) events.push(taskEvent);
      } else if (systemMsg.subtype === "model_refusal_fallback") {
        // The model declined and the CLI moved the turn to another one. Without
        // this the swap is invisible and the run silently answers on a model the
        // user did not pick.
        const category = systemMsg.api_refusal_category
          ? ` (${systemMsg.api_refusal_category})`
          : "";
        events.push({
          type: "log",
          message: `[model] ${systemMsg.original_model ?? "the model"} declined${category} — continuing on ${systemMsg.fallback_model ?? "a fallback model"}`,
          level: "warn",
          ts,
          metadata: {
            source: "model_refusal_fallback",
            originalModel: systemMsg.original_model,
            fallbackModel: systemMsg.fallback_model,
            category: systemMsg.api_refusal_category,
            explanation: systemMsg.api_refusal_explanation,
          },
        });
      } else if (systemMsg.subtype === "model_refusal_no_fallback") {
        const category = systemMsg.api_refusal_category
          ? ` (${systemMsg.api_refusal_category})`
          : "";
        events.push({
          type: "log",
          message: `[model] ${systemMsg.original_model ?? "the model"} declined${category} and no fallback was available`,
          level: "error",
          ts,
          metadata: {
            source: "model_refusal_no_fallback",
            originalModel: systemMsg.original_model,
            category: systemMsg.api_refusal_category,
            explanation: systemMsg.api_refusal_explanation,
          },
        });
      } else if (systemMsg.subtype === "permission_denied") {
        // A rule denied the call before canUseTool could ask, so the approval
        // dialog never appears and the refusal has no other way to surface.
        const reason = systemMsg.decision_reason ?? systemMsg.message;
        events.push({
          type: "log",
          message: `[permission] ${systemMsg.tool_name ?? "tool"} denied${reason ? ` — ${reason}` : ""}`,
          level: "warn",
          ts,
          metadata: {
            source: "permission_denied",
            toolName: systemMsg.tool_name,
            toolUseId: systemMsg.tool_use_id,
            agentId: systemMsg.agent_id,
            reason,
          },
        });
      } else if (systemMsg.subtype === "informational" && systemMsg.content) {
        events.push({
          type: "log",
          message: systemMsg.content,
          level: systemMsg.level === "warning" ? "warn" : "info",
          ts,
          metadata: {
            source: "informational",
            informationalLevel: systemMsg.level,
            preventContinuation: systemMsg.prevent_continuation,
          },
        });
      } else if (systemMsg.subtype === "notification" && systemMsg.text) {
        // Low/medium are ambient CLI chrome; only what the CLI itself marks
        // urgent is worth a transcript line.
        if (systemMsg.priority === "high" || systemMsg.priority === "immediate") {
          events.push({
            type: "log",
            message: `[notice] ${systemMsg.text}`,
            level: "warn",
            ts,
            metadata: { source: "notification", priority: systemMsg.priority },
          });
        }
      }
      // Every other system subtype (thinking_tokens, session_state_changed,
      // hook_*, memory_recall, files_persisted, commands_changed, …) is CLI
      // bookkeeping with no reader here, and is dropped rather than logged.
      break;
    }

    case "rate_limit_event": {
      const rl = (msg as SDKRateLimitEvent).rate_limit_info;
      if (rl) {
        const util =
          typeof rl.utilization === "number" ? ` (${Math.round(rl.utilization * 100)}% used)` : "";
        const resets =
          typeof rl.resetsAt === "number"
            ? ` — resets ${new Date(rl.resetsAt * 1000).toLocaleTimeString()}`
            : "";
        const scope = rl.rateLimitType ? ` [${rl.rateLimitType}]` : "";
        // Only a rejection earns a transcript line. `allowed_warning` fires on
        // every turn once you are anywhere near the limit, so it landed twice
        // per message in warn styling to say something you cannot act on
        // mid-run. A percentage belongs in ambient UI — where Codex and Copilot
        // already show it — not in the middle of a conversation.
        if (rl.status === "rejected") {
          // Remembered so the turn's own `rate_limit` error does not repeat what
          // this line already said with the scope and the reset time attached.
          cs.state.sawRateLimitNotice = true;
          events.push({
            type: "log",
            message: `[rate-limit] Rate limit reached${scope}${util}${resets}`,
            level: "error",
            ts,
            metadata: { source: "rate_limit_event", ...rl },
          });
        }
      }
      break;
    }

    case "result": {
      const resultMsg = msg as SDKResultMessage;

      if (
        resultMsg.subtype === "success" &&
        resultMsg.result &&
        !cs.state.hasAssistantContent
      ) {
        events.push({
          type: "artifact",
          kind: "report",
          content: resultMsg.result,
          metadata: { source: "result.message" },
        });
      }

      if (resultMsg.stop_reason && resultMsg.stop_reason !== "end_turn") {
        events.push({
          type: "log",
          message: `[stop_reason] ${resultMsg.stop_reason}`,
          level: resultMsg.stop_reason === "refusal" ? "error" : "info",
          ts,
        });
      }

      if (resultMsg.subtype !== "success" && resultMsg.is_error) {
        events.push({
          type: "log",
          message: `[error] ${resultMsg.errors.join(", ")}`,
          level: "error",
          ts,
        });
      }

      // Also checked here: fast mode can drop to cooldown mid-run after a rate
      // limit, long after init reported it active.
      const fastModeEvent = buildFastModeEvent(
        {
          requested: cs.fastModeRequested,
          state: resultMsg.fast_mode_state,
          reason: resultMsg.fast_mode_disabled_reason,
          lastState: cs.state.lastFastModeState,
        },
        ts,
      );
      if (fastModeEvent) {
        cs.state.lastFastModeState = resultMsg.fast_mode_state;
        events.push(fastModeEvent);
      }
      break;
    }

    case "tool_progress": {
      // A heartbeat for a long-running tool call. The only part worth a line is
      // a subagent quietly retrying — everything else would spam the transcript.
      const progress = msg as {
        tool_name?: string;
        subagent_retry?: {
          attempt: number;
          max_retries: number;
          error_category?: string;
        };
      };
      const retry = progress.subagent_retry;
      if (retry) {
        const category = retry.error_category ? ` (${retry.error_category})` : "";
        events.push({
          type: "log",
          message: `[subagent] retrying ${progress.tool_name ?? "call"}${category} — attempt ${retry.attempt}/${retry.max_retries}`,
          level: "warn",
          ts,
          metadata: { source: "subagent_retry", ...retry },
        });
      }
      break;
    }

    case "tool_use_summary": {
      const summary = (msg as { summary?: string }).summary;
      if (summary) {
        events.push({
          type: "log",
          message: summary,
          level: "info",
          ts,
          metadata: { source: "tool_use_summary" },
        });
      }
      break;
    }

    case "prompt_suggestion": {
      const suggestionMsg = msg as { type: "prompt_suggestion"; suggestion: string };
      if (suggestionMsg.suggestion) {
        events.push({
          type: "prompt_suggestion",
          suggestion: suggestionMsg.suggestion,
          ts,
        });
      }
      break;
    }

    case "stream_event": {
      const partialMsg = msg as SDKPartialAssistantMessage;
      const event = partialMsg.event;
      if (!event) break;

      // Skip subagent streams — they would pollute the parent timeline
      if (partialMsg.parent_tool_use_id) break;

      const blockIndex = typeof event.index === "number" ? event.index : -1;

      if (event.type === "content_block_delta" && event.delta && blockIndex >= 0) {
        const bufferKey = `${cs.runId}-${blockIndex}`;

        if (event.delta.type === "text_delta" && event.delta.text) {
          const next = (cs.partialTextBuffers.get(bufferKey) ?? "") + event.delta.text;
          cs.partialTextBuffers.set(bufferKey, next);
          events.push({
            type: "artifact",
            kind: "report",
            content: next,
            metadata: { source: "agent_message_streaming" },
            ephemeral: true,
            streamId: `claude-msg-${cs.runId}-${blockIndex}`,
          });
        } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          const next = (cs.partialThinkingBuffers.get(bufferKey) ?? "") + event.delta.thinking;
          cs.partialThinkingBuffers.set(bufferKey, next);
          events.push({
            type: "artifact",
            kind: "report",
            content: next,
            metadata: { source: "agent_thinking_streaming" },
            ephemeral: true,
            streamId: `claude-think-${cs.runId}-${blockIndex}`,
          });
        }
      } else if (event.type === "content_block_stop" && blockIndex >= 0) {
        const key = `${cs.runId}-${blockIndex}`;
        // Thinking lane has no DB-persisted counterpart, so the content-match filter
        // in the renderer won't auto-clear it. Push an empty update.
        if (cs.partialThinkingBuffers.has(key)) {
          events.push({
            type: "artifact",
            kind: "report",
            content: "",
            metadata: { source: "agent_thinking_streaming" },
            ephemeral: true,
            streamId: `claude-think-${cs.runId}-${blockIndex}`,
          });
        }
        cs.partialTextBuffers.delete(key);
        cs.partialThinkingBuffers.delete(key);
      } else if (event.type === "message_stop") {
        for (const key of cs.partialTextBuffers.keys()) {
          if (key.startsWith(`${cs.runId}-`)) cs.partialTextBuffers.delete(key);
        }
        for (const key of cs.partialThinkingBuffers.keys()) {
          if (key.startsWith(`${cs.runId}-`)) cs.partialThinkingBuffers.delete(key);
        }
      }
      break;
    }

    default: {
      // Tool result-style messages (tool_use_id correlation).
      //
      // Requiring an actual payload matters: `tool_progress` heartbeats also
      // carry a tool_use_id, and treating one as a result would close a still-
      // running tool call and drop it from toolCallIndex, so the real result
      // would later resolve to toolName "unknown".
      const anyMsg = msg as any;
      const looksLikeToolResult =
        anyMsg.type === "tool_result" ||
        (anyMsg.tool_use_id !== undefined &&
          (anyMsg.content !== undefined || anyMsg.result !== undefined));
      if (looksLikeToolResult) {
        const toolUseId = anyMsg.tool_use_id || "";
        const prev = toolUseId ? cs.toolCallIndex.get(toolUseId) : undefined;

        const toolName = prev?.toolName || "unknown";
        const input = prev?.input;
        const output = anyMsg.content || anyMsg.result;
        const error = anyMsg.is_error ? String(output) : undefined;

        if (toolUseId) cs.toolCallIndex.delete(toolUseId);

        events.push({
          type: "tool_call",
          toolName,
          input: input as Record<string, unknown> | undefined,
          output,
          error,
          endedAt: ts,
          metadata: {
            phase: "complete",
            toolCallId: toolUseId || undefined,
            rawType: msg.type,
          },
        });

        if (toolName === SUBAGENT_TOOL_NAME) {
          events.push(
            buildSubagentCompletionEvent({ input, output, error, toolUseId, ts }),
          );
        }
      } else {
        // The net for a message type this driver has never seen. Bounded: an
        // unknown payload can be arbitrarily large, and a transcript line is a
        // poor place to discover that.
        const dump = safeJson(msg);
        events.push({
          type: "log",
          message: `[event] ${msg.type}: ${dump.length > 500 ? `${dump.slice(0, 500)}…` : dump}`,
          level: "info",
          ts,
        });
      }
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────
// Driver factory
// ─────────────────────────────────────────────────────────────

export function createClaudeDriver(config: ClaudeCodeAdapterConfig): ProviderDriver {
  // SDK loader state
  let sdkLoaded = false;
  let loadError: Error | null = null;
  let queryFn: ((options: { prompt: string; options?: SDKOptions }) => SDKQuery) | null = null;
  let createSdkMcpServerFn: ((...args: any[]) => any) | null = null;
  let toolFn: ((...args: any[]) => any) | null = null;
  // Standalone SDK fn that reads a persisted session's info (incl. the CLI's
  // auto-generated aiTitle) from the JSONL transcript. Used for run titling.
  let getSessionInfoFn:
    | ((sessionId: string, options?: { dir?: string }) => Promise<SDKSessionInfoLite | undefined>)
    | null = null;
  // Standalone SDK fn that removes a persisted session: `{sessionId}.jsonl` plus
  // the `{sessionId}/` subagent-transcript subdirectory. Clearing our own DB
  // column does not touch either, so without this the transcripts accumulate.
  let deleteSdkSessionFn:
    | ((sessionId: string, options?: { dir?: string }) => Promise<void>)
    | null = null;

  // Cross-run TTL caches
  let cachedModels: ModelInfo[] | null = null;
  let cachedModelsTimestamp = 0;
  const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

  const commandsCache = new Map<
    string,
    { commands: CommandInfo[]; timestamp: number }
  >();
  const COMMANDS_CACHE_TTL_MS = 10 * 60 * 1000;

  const skillsCache = new Map<string, { skills: SkillInfo[]; timestamp: number }>();
  const SKILLS_CACHE_TTL_MS = 5 * 60 * 1000;

  // Plugins are fetched via the `claude plugin` CLI subcommands; `--available`
  // can trigger a remote marketplace sync, so cache the result.
  let cachedPlugins: PluginListResponse | null = null;
  let cachedPluginsTimestamp = 0;
  const PLUGINS_CACHE_TTL_MS = 5 * 60 * 1000;

  // A plugin change adds/removes commands, skills, and agents — so installing or
  // uninstalling one must invalidate those caches too, not just the plugin list.
  function invalidatePluginCaches(): void {
    cachedPlugins = null;
    cachedPluginsTimestamp = 0;
    commandsCache.clear();
    skillsCache.clear();
  }

  // Cross-run sessionId memo (resume lookup avoids hitting the DB every time)
  const sessionIdMemo = new Map<string, string>();

  // ─────────────────────────────────────────────────────────────
  // SDK loader
  // ─────────────────────────────────────────────────────────────

  async function ensureSDK(): Promise<void> {
    if (loadError) throw loadError;
    if (sdkLoaded) return;

    try {
      const ClaudeSDK = await import("@anthropic-ai/claude-agent-sdk").catch(() => null);

      if (!ClaudeSDK) {
        throw new Error(
          "Claude Agent SDK (@anthropic-ai/claude-agent-sdk) is not installed. " +
            "Please install it to use the Claude provider: npm install @anthropic-ai/claude-agent-sdk",
        );
      }

      const query = (ClaudeSDK as any).query;
      if (!query) {
        throw new Error(
          "Could not find query() in @anthropic-ai/claude-agent-sdk. " +
            "Make sure you have the latest version installed.",
        );
      }

      queryFn = query;
      createSdkMcpServerFn = (ClaudeSDK as any).createSdkMcpServer ?? null;
      toolFn = (ClaudeSDK as any).tool ?? null;
      getSessionInfoFn = (ClaudeSDK as any).getSessionInfo ?? null;
      deleteSdkSessionFn = (ClaudeSDK as any).deleteSession ?? null;
      sdkLoaded = true;
      logInfo("SDK loaded successfully");
    } catch (error) {
      loadError = error instanceof Error ? error : new Error(String(error));
      logError("Failed to load SDK:", loadError.message);
      throw loadError;
    }
  }

  function getModel(requestModel?: string | null): string {
    return requestModel || config.defaultModel || "claude-opus-4-8";
  }

  // ─────────────────────────────────────────────────────────────
  // Hook builders
  // ─────────────────────────────────────────────────────────────

  function buildPostToolUseHook(onEvent: WorkRunEventHandler): SDKHookMatcher {
    return {
      hooks: [
        async (
          input: Record<string, unknown>,
          toolUseId: string | null,
        ): Promise<Record<string, unknown>> => {
          const toolName = (input.tool_name as string) || "unknown";
          const toolResponse = input.tool_response;

          if (toolResponse !== undefined) {
            await onEvent({
              type: "tool_call",
              toolName,
              output: toolResponse,
              endedAt: Date.now(),
              metadata: {
                phase: "complete",
                toolCallId: toolUseId || undefined,
              },
            });
          }

          return {};
        },
      ],
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Hooks / agents config merging + SDK conversion
  // ─────────────────────────────────────────────────────────────

  function mergeAgentsConfig(
    configAgents?: AgentsConfig,
    runAgents?: AgentsConfig,
  ): AgentsConfig | undefined {
    if (!configAgents && !runAgents) return undefined;
    if (!configAgents) return runAgents;
    if (!runAgents) return configAgents;
    return { ...configAgents, ...runAgents };
  }

  function convertAgentsConfig(agents: AgentsConfig): SDKAgentsConfig {
    const sdkAgents: SDKAgentsConfig = {};
    for (const [agentName, agentDef] of Object.entries(agents)) {
      sdkAgents[agentName] = {
        description: agentDef.description,
        prompt: agentDef.prompt,
        tools: agentDef.tools,
        disallowedTools: agentDef.disallowedTools,
        model: agentDef.model,
        mcpServers: agentDef.mcpServers,
        skills: agentDef.skills,
        initialPrompt: agentDef.initialPrompt,
        maxTurns: agentDef.maxTurns,
        criticalSystemReminder_EXPERIMENTAL: agentDef.criticalSystemReminder_EXPERIMENTAL,
      };
    }
    return sdkAgents;
  }

  function mergeHooksConfig(
    configHooks?: HooksConfig,
    runHooks?: HooksConfig,
  ): HooksConfig | undefined {
    if (!configHooks && !runHooks) return undefined;
    if (!configHooks) return runHooks;
    if (!runHooks) return configHooks;

    const merged: HooksConfig = { ...configHooks };
    for (const [eventName, matchers] of Object.entries(runHooks)) {
      const key = eventName as keyof HooksConfig;
      if (merged[key]) {
        merged[key] = [...merged[key]!, ...(matchers || [])];
      } else {
        merged[key] = matchers;
      }
    }
    return merged;
  }

  function convertHooksConfig(hooks: HooksConfig): SDKHooksConfig {
    const sdkHooks: SDKHooksConfig = {};
    for (const [eventName, matchers] of Object.entries(hooks)) {
      if (!matchers || matchers.length === 0) continue;
      sdkHooks[eventName] = matchers.map((matcher: HookMatcher) => ({
        matcher: matcher.matcher,
        hooks: matcher.hooks.map(
          (hookFn) =>
            async (
              input: Record<string, unknown>,
              toolUseId: string | null,
              context: { signal: AbortSignal },
            ) => {
              try {
                const result = await hookFn(input as any, toolUseId, context);
                return result as Record<string, unknown>;
              } catch (error) {
                logError(`Hook error in ${eventName}:`, error);
                return {};
              }
            },
        ),
        timeout: matcher.timeout,
      }));
    }
    return sdkHooks;
  }

  // ─────────────────────────────────────────────────────────────
  // Mains MCP server (in-process)
  // ─────────────────────────────────────────────────────────────

  function buildMainsMcpServer(
    workspaceId: string | null,
    rootPath: string | null,
    runId: string | null,
    mode?: ModeId,
  ): any {
    const ctx: MainsToolContext = { workspaceId, rootPath, runId };

    const tools = toClaudeTools(ctx, mode);
    if (tools.length === 0) return null;
    return createSdkMcpServerFn!({
      name: "mains",
      version: "1.0.0",
      tools: tools.map((t) =>
        toolFn!(t.name, t.description, t.shape, t.handler),
      ),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // SDK options builder
  // ─────────────────────────────────────────────────────────────

  async function buildOptions(args: {
    model: string;
    workspacePath?: string;
    abortController?: AbortController;
    resumeSessionId?: string;
    runHooks?: HooksConfig;
    runAgents?: AgentsConfig;
    runId?: string;
    workspaceId?: string | null;
    forkSession?: boolean;
    /** UUID to open the new (or forked) session on. Omitted when resuming. */
    newSessionId?: string;
    onEvent?: WorkRunEventHandler;
    permissionMode?: NonNullable<SDKOptions["permissionMode"]>;
    /** Mode/space instruction delta, appended to the claude_code preset. */
    extraInstructions?: string | null;
    /** Experience mode — filters which mains tools the MCP server exposes. */
    mode?: ModeId;
    /** Per-run tool policy from the mode harness. */
    toolPolicy?: WorkRunToolPolicy | null;
  }): Promise<SDKOptions> {
    const {
      model,
      workspacePath,
      abortController,
      resumeSessionId,
      runHooks,
      runAgents,
      runId,
      workspaceId,
      forkSession,
      newSessionId,
      onEvent,
      permissionMode: runPermissionMode,
      extraInstructions,
      mode,
      toolPolicy,
    } = args;

    const packagedSdkBinary = config.binary
      ? null
      : findPackagedClaudeSdkBinary();
    const executableOptions = buildClaudeExecutableOptions(
      config.binary,
      packagedSdkBinary,
    );
    if (config.binary && !executableOptions.pathToClaudeCodeExecutable) {
      logWarn(
        `Configured binary path "${config.binary}" is not a valid executable; using the SDK-bundled Claude CLI`,
      );
    } else if (executableOptions.pathToClaudeCodeExecutable) {
      logInfo(
        config.binary
          ? "Using configured Claude CLI at:"
          : "Using packaged SDK-bundled Claude CLI at:",
        executableOptions.pathToClaudeCodeExecutable,
      );
    } else {
      logInfo("Using SDK-bundled Claude CLI");
    }

    // Strip API key/auth token when using CLI (subscription mode) so the subprocess
    // uses CLI login session rather than API billing.
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;
    delete cleanEnv.ANTHROPIC_AUTH_TOKEN;

    const permissionMode =
      runPermissionMode ?? config.permissionMode ?? DEFAULT_CLAUDE_PERMISSION_MODE;
    const settingSources = config.settingSources ?? ["user", "project", "local"];
    // The bridge auto-allows this set, so it must see the *effective* list —
    // handing it the global default would auto-approve tools the run's policy
    // just denied.
    const effectiveAllowedTools = toolPolicy
      ? new Set(resolveEffectiveAllowedTools(toolPolicy))
      : ALLOWED_TOOLS_SET;
    const permissionBridge = runId
      ? createClaudePermissionBridge({
          runId,
          allowedTools: effectiveAllowedTools,
          bypassMode: permissionMode === "bypassPermissions",
          restrictedToolset: !!toolPolicy?.allowedTools,
        })
      : null;

    const mcpServers = readMcpServersFromSettings(settingSources, workspacePath);
    if (!mcpServers["mains"] && createSdkMcpServerFn && toolFn) {
      const mainsServer = buildMainsMcpServer(workspaceId ?? null, workspacePath ?? null, runId ?? null, mode);
      if (mainsServer) {
        mcpServers["mains"] = mainsServer;
        logInfo("Injected mains MCP server (in-process)");
      }
    }

    const options: SDKOptions = {
      model,
      ...buildClaudePermissionModeOptions(
        permissionMode,
        permissionBridge?.canUseTool,
        toolPolicy,
      ),
      abortController,
      ...executableOptions,
      env: cleanEnv,
      settingSources,
    };

    if (Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }

    if (workspacePath) options.cwd = workspacePath;

    if (resumeSessionId) {
      options.resume = resumeSessionId;
      if (forkSession) options.forkSession = true;
    }

    Object.assign(
      options,
      buildClaudeSessionIdOptions({ newSessionId, resumeSessionId, forkSession }),
    );

    const mergedAgents = mergeAgentsConfig(config.agents, runAgents);
    if (mergedAgents && Object.keys(mergedAgents).length > 0) {
      options.agents = convertAgentsConfig(mergedAgents);
    }

    if (config.plugins && config.plugins.length > 0) {
      options.plugins = config.plugins.map((p) => ({
        type: "local" as const,
        path: p.path,
        ...(p.skipMcpDiscovery !== undefined ? { skipMcpDiscovery: p.skipMcpDiscovery } : {}),
      }));
      logInfo(`Loading ${options.plugins.length} local plugin(s)`);
    }

    const mergedHooks = mergeHooksConfig(config.hooks, runHooks);
    if (mergedHooks && Object.keys(mergedHooks).length > 0) {
      options.hooks = convertHooksConfig(mergedHooks);
    }

    if (config.structuredOutputsSelectedId && config.structuredOutputs) {
      const entry = config.structuredOutputs[config.structuredOutputsSelectedId];
      if (entry?.schema) {
        options.outputFormat = { type: "json_schema", schema: entry.schema };
      }
    }

    // ultracode implies xhigh effort, and the API rejects xhigh outright when
    // thinking is disabled ("effort 'xhigh' is not supported when thinking is
    // disabled on this model"). A stale `thinkingMode: false` alongside
    // `ultracode: true` must therefore not reach the CLI — ultracode wins.
    const thinkingEnabled = !!config.thinkingMode || !!config.ultracode;
    if (thinkingEnabled) {
      // A fixed token budget takes precedence over adaptive thinking. Useful on
      // models without adaptive support, or to cap cost/latency.
      options.thinking =
        typeof config.thinkingBudgetTokens === "number" && config.thinkingBudgetTokens > 0
          ? { type: "enabled", budgetTokens: config.thinkingBudgetTokens }
          : { type: "adaptive" };
    } else {
      options.thinking = { type: "disabled" };
    }
    if (config.ultracode) {
      // ultracode = xhigh effort + automatic dynamic-workflow orchestration.
      // The CLI applies xhigh itself, so we must NOT also send a conflicting
      // options.effort ("ultracode" is not a valid EffortLevel). Delivered via
      // the same settings passthrough fastMode uses below.
      options.settings = {
        ...((options.settings as Record<string, unknown>) || {}),
        ultracode: true,
      };
    } else if (thinkingEnabled && config.effortLevel) {
      options.effort = config.effortLevel;
    }

    if (config.fastMode) {
      options.settings = {
        ...((options.settings as Record<string, unknown>) || {}),
        fastMode: true,
      };
    }

    options.promptSuggestions = true;
    options.includePartialMessages = true;

    // Without a handler the SDK declines every MCP elicitation automatically,
    // so a server asking for a form or an auth URL fails silently.
    if (runId) {
      options.onElicitation = createClaudeElicitationHandler({ runId });
    }

    {
      const guardHook = await guardsService.buildClaudeGuardHook();
      if (guardHook) {
        if (!options.hooks) options.hooks = {};
        if (!options.hooks.PreToolUse) options.hooks.PreToolUse = [];
        options.hooks.PreToolUse.push(guardHook);
      }
    }

    if (runId && onEvent) {
      if (!options.hooks) options.hooks = {};
      if (!options.hooks.PostToolUse) options.hooks.PostToolUse = [];
      options.hooks.PostToolUse.push(buildPostToolUseHook(onEvent));
    }

    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      ...(extraInstructions ? { append: extraInstructions } : {}),
    };

    if (runId && options.settings && typeof options.settings !== "string") {
      options.settings = writeClaudeRuntimeSettings(options.settings);
    }

    return options;
  }

  // ─────────────────────────────────────────────────────────────
  // Prompt building
  // ─────────────────────────────────────────────────────────────

  /** User-pinned skill names ($) — filesystem metadata is enough; prompt only echoes names for transparency. */
  function prependPinnedSkillsToPrompt(
    prompt: string,
    skills: WorkRunRequest["skills"],
  ): string {
    if (!skills?.length) return prompt;
    const tokens = skills.map((s) => `${s.name}`).join(" ");
    return `${tokens}\n\n${prompt}`;
  }

  function buildStartPrompt(request: WorkRunRequest): string {
    let prompt = request.goal;
    if (request.context && request.context.length > 0) {
      const contextParts = formatContextSection(request.context);
      prompt = `Context:\n${contextParts}\n\n---\n\n ${request.goal}`;
    }
    prompt = appendPromptSections(prompt, {
      contextIssues: request.contextIssues,
      contextSignals: request.contextSignals,
      contextFiles: request.contextFiles,
      attachments: request.attachments,
      runId: request.runId,
    });
    return prependPinnedSkillsToPrompt(prompt, request.skills);
  }

  function buildContinuePrompt(request: WorkRunContinueRequest): string {
    let prompt = request.message;
    if (request.context && request.context.length > 0) {
      const contextParts = formatContextSection(request.context);
      prompt = `Context:\n${contextParts}\n\n---\n\n${request.message}`;
    }
    prompt = appendPromptSections(prompt, {
      contextIssues: request.contextIssues,
      contextSignals: request.contextSignals,
      contextFiles: request.contextFiles,
      attachments: request.attachments,
      runId: request.runId,
    });
    return prependPinnedSkillsToPrompt(prompt, request.skills);
  }

  function buildForkPrompt(request: WorkRunForkRequest): string {
    let prompt = request.message;
    if (request.context && request.context.length > 0) {
      const contextParts = formatContextSection(request.context);
      prompt = `Context:\n${contextParts}\n\n---\n\n${request.message}`;
    }
    return appendPromptSections(prompt, {
      attachments: request.attachments,
      runId: request.runId,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Disk skills discovery (shared between listSkills and listCommands filtering)
  // ─────────────────────────────────────────────────────────────

  async function fetchDiskSkills(workspacePath?: string): Promise<SkillInfo[]> {
    const cacheKey = workspacePath ?? "__global__";
    const now = Date.now();
    const cached = skillsCache.get(cacheKey);
    if (cached && now - cached.timestamp < SKILLS_CACHE_TTL_MS) {
      return cached.skills;
    }

    try {
      const settingSources = config.settingSources ?? ["user", "project", "local"];
      const skills: SkillInfo[] = [];

      if (settingSources.includes("user")) {
        const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
        const userSkills = await discoverSkillsFromDirectory(userSkillsDir, "user");
        skills.push(...userSkills);
      }

      if (settingSources.includes("project") && workspacePath) {
        const projectSkillsDir = path.join(workspacePath, ".claude", "skills");
        const projectSkills = await discoverSkillsFromDirectory(projectSkillsDir, "project");
        skills.push(...projectSkills);
      }

      skillsCache.set(cacheKey, { skills, timestamp: now });
      return skills;
    } catch (error) {
      logError("Failed to discover skills:", error);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Acquisition helpers
  // ─────────────────────────────────────────────────────────────

  function newSession(
    runId: string,
    options: SDKOptions,
    abortController: AbortController,
    isInitial: boolean,
  ): ClaudeSession {
    return {
      runId,
      options,
      abortController,
      runtimeSettingsPath:
        typeof options.settings === "string" ? options.settings : undefined,
      fastModeRequested: !!config.fastMode,
      isInitial,
      state: { hasAssistantContent: false },
      toolCallIndex: new Map(),
      taskIndex: new Map(),
      partialTextBuffers: new Map(),
      partialThinkingBuffers: new Map(),
    };
  }

  /**
   * Read the CLI's auto-generated session title (aiTitle) from the persisted
   * transcript. The CLI writes aiTitle asynchronously right after the first
   * turn, so this retries briefly. Returns null when only the first prompt is
   * available (no AI/custom title yet) — callers keep the provisional title.
   */
  async function readAutoTitle(sessionId: string, dir?: string): Promise<string | null> {
    if (!getSessionInfoFn) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const info = await getSessionInfoFn(sessionId, dir ? { dir } : undefined);
        if (info?.summary && info.summary !== info.firstPrompt) {
          const title = info.summary.trim();
          if (title) return title.length > 80 ? title.slice(0, 80) : title;
        }
      } catch (err) {
        logWarn(
          `readAutoTitle attempt ${attempt + 1} failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return null;
  }

  async function lookupSessionId(runId: string): Promise<string | undefined> {
    const memo = sessionIdMemo.get(runId);
    if (memo) return memo;
    try {
      const run = await runsRepo.findRunById(runId);
      if (run?.sessionId) {
        sessionIdMemo.set(runId, run.sessionId);
        return run.sessionId;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────
  // CLI helpers (version + self-update via the Claude Code CLI)
  // ─────────────────────────────────────────────────────────────

  function resolveClaudeBinary(): string | null {
    if (config.binary) {
      const resolved = resolveCandidate(config.binary);
      if (resolved) return resolved;
    }
    return findClaudeBinary();
  }

  /** Run a one-shot `claude <args>` CLI command. */
  function runClaudeCli(
    args: string[],
    timeoutMs: number,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const binaryPath = resolveClaudeBinary();
    if (!binaryPath) {
      return Promise.resolve({ stdout: "", stderr: "Claude CLI not found", code: null });
    }
    return new Promise((resolve) => {
      const child = spawn(binaryPath, args, {
        env: { ...process.env, HOME: os.homedir() },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        // project/local scope ops resolve the scope relative to cwd; run them in
        // the directory the plugin was installed from.
        ...(cwd ? { cwd } : {}),
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ stdout, stderr, code }));
      child.on("error", (err) =>
        resolve({ stdout, stderr: String(err instanceof Error ? err.message : err), code: null }),
      );
    });
  }

  /** Read the installed Claude Code version (e.g. "2.1.159" from "2.1.159 (Claude Code)"). */
  async function getClaudeVersion(): Promise<string | null> {
    try {
      const { stdout } = await runClaudeCli(["--version"], 8000);
      const match = stdout.trim().match(/(\d+\.\d+\.\d+[^\s]*)/);
      return match ? match[1] : stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Read login state via `claude auth status --json`. Returns undefined when
   * the CLI predates the `auth` subcommand (or output is unparseable) so the
   * caller can fall back to the SDK control query; null means definitively
   * signed out.
   */
  async function readAccountFromAuthStatus(): Promise<
    AccountInfo["account"] | undefined
  > {
    const { stdout } = await runClaudeCli(["auth", "status", "--json"], 15000);
    // A signed-out status can exit non-zero but still print JSON — parse
    // stdout regardless of exit code.
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) return undefined;
    try {
      const status = JSON.parse(stdout.slice(jsonStart));
      if (typeof status?.loggedIn !== "boolean") return undefined;
      if (!status.loggedIn) return null;
      if (typeof status.email === "string" && status.email) {
        return {
          type: "claude",
          email: status.email,
          planType: status.subscriptionType ?? status.orgName ?? "",
        };
      }
      return { type: "apiKey" };
    } catch {
      return undefined;
    }
  }

  /**
   * One-shot, tool-free text generation via a cheap model. Shared by the
   * generateText() and generateTitle() driver methods.
   */
  async function generateOneShotText(
    prompt: string,
    opts?: { system?: string; model?: string },
  ): Promise<string> {
    await ensureSDK();
    if (!queryFn) throw new Error("Claude SDK not properly initialized");

    const options = await buildOptions({
      model: opts?.model ?? "claude-haiku-4-5-20251001",
    });
    // Strip the MCP servers buildOptions injects so the model is never tempted
    // to call a tool — with no tools available it just answers. maxTurns gets a
    // little slack (not 1) so a stray first-message hiccup can't trip
    // "error_max_turns" before the final text lands; without tools it still
    // finishes in a single turn normally.
    options.maxTurns = 6;
    options.allowedTools = [];
    options.disallowedTools = ["*"];
    options.mcpServers = {};
    options.systemPrompt =
      opts?.system ??
      "You are a helpful assistant. Follow the user's instructions exactly and output only what is requested.";

    let text = "";
    try {
      const query = queryFn({ prompt, options });
      for await (const msg of query) {
        if (msg.type === "assistant") {
          const assistantMsg = msg as {
            message?: { content?: Array<{ type: string; text?: string }> };
          };
          for (const block of assistantMsg.message?.content ?? []) {
            if (block.type === "text" && block.text) text += block.text;
          }
        }
      }
    } catch (err) {
      // The SDK throws on error results (e.g. max turns). If the model already
      // produced text before that, use it; otherwise surface the failure.
      if (!text.trim()) throw err;
    }

    return text.trim();
  }

  // ─────────────────────────────────────────────────────────────
  // ProviderDriver implementation
  // ─────────────────────────────────────────────────────────────

  return {
    async createSession(request: WorkRunRequest): Promise<AcquiredSession> {
      await ensureSDK();
      if (!queryFn) throw new Error("Claude SDK not properly initialized");

      const abortController = new AbortController();
      const overridePermissionMode = request.configSnapshot?.permissionMode;
      const sessionId = randomUUID();
      const options = await buildOptions({
        model: getModel(request.model),
        workspacePath: request.execution.cwd,
        abortController,
        runHooks: request.hooks,
        runAgents: request.agents,
        runId: request.runId,
        workspaceId: request.execution.workspaceId,
        newSessionId: sessionId,
        permissionMode: isSDKPermissionMode(overridePermissionMode)
          ? overridePermissionMode
          : undefined,
        extraInstructions: request.extraInstructions,
        mode: request.mode,
        toolPolicy: request.toolPolicy,
      });

      const session = newSession(request.runId, options, abortController, true);
      session.state.sessionId = sessionId;
      sessionIdMemo.set(request.runId, sessionId);
      return { session, prompt: buildStartPrompt(request), sessionId };
    },

    async resumeSession(request: WorkRunContinueRequest): Promise<AcquiredSession> {
      await ensureSDK();
      if (!queryFn) throw new Error("Claude SDK not properly initialized");

      const sessionId = await lookupSessionId(request.runId);
      if (!sessionId) {
        throw new Error(
          `Session not found for run ${request.runId}. The session may have expired or was never created.`,
        );
      }

      const abortController = new AbortController();
      const resumePermissionMode = request.configSnapshot?.permissionMode;
      const options = await buildOptions({
        model: getModel(request.model ?? config.defaultModel),
        workspacePath: request.execution.cwd,
        abortController,
        resumeSessionId: sessionId,
        runHooks: request.hooks,
        runAgents: request.agents,
        runId: request.runId,
        workspaceId: request.execution.workspaceId,
        permissionMode: isSDKPermissionMode(resumePermissionMode)
          ? resumePermissionMode
          : undefined,
        extraInstructions: request.extraInstructions,
        mode: request.mode,
        toolPolicy: request.toolPolicy,
      });

      const session = newSession(request.runId, options, abortController, false);
      // Prime sessionId so executePrompt's "first session_id" persistence is a no-op for resume;
      // the SDK keeps the same id when resuming.
      session.state.sessionId = sessionId;
      return { session, prompt: buildContinuePrompt(request) };
    },

    async forkSession(request: WorkRunForkRequest): Promise<AcquiredSession> {
      await ensureSDK();
      if (!queryFn) throw new Error("Claude SDK not properly initialized");

      const sourceSessionId = await lookupSessionId(request.sourceRunId);
      if (!sourceSessionId) {
        throw new Error(
          `Session not found for source run ${request.sourceRunId}. Cannot fork.`,
        );
      }

      const abortController = new AbortController();
      // A fork gets a new id, and the CLI lets us name it — so the fork is
      // identified before it produces anything, same as a fresh session.
      const sessionId = randomUUID();
      const forkPermissionMode = request.configSnapshot?.permissionMode;
      const options = await buildOptions({
        model: getModel(request.model ?? config.defaultModel),
        workspacePath: request.execution.cwd,
        abortController,
        resumeSessionId: sourceSessionId,
        runHooks: request.hooks,
        runAgents: request.agents,
        runId: request.runId,
        workspaceId: request.execution.workspaceId,
        forkSession: true,
        newSessionId: sessionId,
        permissionMode: isSDKPermissionMode(forkPermissionMode)
          ? forkPermissionMode
          : undefined,
        extraInstructions: request.extraInstructions,
        mode: request.mode,
        toolPolicy: request.toolPolicy,
      });

      const session = newSession(request.runId, options, abortController, true);
      session.state.sessionId = sessionId;
      sessionIdMemo.set(request.runId, sessionId);
      return { session, prompt: buildForkPrompt(request), sessionId };
    },

    async executePrompt(
      sessionParam,
      prompt,
      onEvent,
      signal,
    ): Promise<DriverOutcome> {
      const cs = sessionParam as ClaudeSession;
      const timeout = config.timeout ?? 3_600_000;
      if (!queryFn) throw new Error("Claude SDK not properly initialized");

      // Wire the incoming AbortSignal to fire BOTH the SDK's AbortController and query.interrupt().
      const onAbort = () => {
        try {
          cs.abortController.abort();
        } catch (err) {
          logError("Error aborting controller:", err);
        }
        if (cs.query?.interrupt) {
          cs.query.interrupt().catch(() => {
            /* shutdown interrupt is best-effort */
          });
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });

      // Create the SDK query (this is when the prompt is bound to the session).
      const query = queryFn({ prompt, options: cs.options });
      cs.query = query;

      let timeoutId: NodeJS.Timeout | undefined;
      let timedOut = false;
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          cs.abortController.abort();
          reject(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);
      });

      try {
        // Context meter, in preference order:
        //   1. The `get_context_usage` control reply — the CLI's own `/context`
        //      report, with the category breakdown and the autocompact
        //      threshold. Requested while the stream is live; the reason the
        //      driver used to avoid it is that requesting it around teardown
        //      answers "Query closed before response".
        //   2. `context_usage` on an assistant message, which per the CLI's
        //      schema only ever rides the synthetic reply to `/context`.
        //   3. A per-request snapshot from `message.usage`, sized against the
        //      window in result.modelUsage — for a CLI too old for (1).
        let sawContextUsage = false;
        let lastReqContextTokens = 0;
        let contextUsageInFlight = false;
        let contextUsageAt = 0;
        // The reply is a whole-context token count, so it is asked for at a
        // human-readable cadence rather than once per assistant message.
        const CONTEXT_USAGE_MIN_INTERVAL_MS = 2_000;

        function refreshContextUsage(): void {
          const now = Date.now();
          if (contextUsageInFlight) return;
          if (contextUsageAt && now - contextUsageAt < CONTEXT_USAGE_MIN_INTERVAL_MS) return;
          if (typeof cs.query?.getContextUsage !== "function") return;
          contextUsageInFlight = true;
          contextUsageAt = now;
          // Fire-and-forget: the meter is an indicator and must never hold up
          // the transcript stream.
          void cs.query
            .getContextUsage()
            .then((response) => {
              const event = mapContextUsageResponse(response, Date.now());
              if (!event) return;
              sawContextUsage = true;
              return onEvent(event);
            })
            .catch(() => {
              // A CLI without the control handler, or a closed query — the
              // modelUsage fallback covers the meter either way.
            })
            .finally(() => {
              contextUsageInFlight = false;
            });
        }

        const streamPromise = (async () => {
          for await (const msg of query) {
            if (signal.aborted || timedOut) break;

            // Track whether any assistant text content has been streamed (for result-message dedup).
            if (msg.type === "assistant") {
              const aMsg = msg as SDKAssistantMessage;
              if (aMsg.message?.content?.some((b: any) => b.type === "text" && b.text)) {
                cs.state.hasAssistantContent = true;
              }
              // (1) Ask the CLI where the window stands. Driven off assistant
              // messages so a long tool-using turn keeps the meter live rather
              // than updating it once at the end.
              if (!aMsg.parent_tool_use_id) refreshContextUsage();

              // (2) The `/context` reply, when a run happens to invoke it.
              const ctxEvent = buildContextUsageEvent(aMsg, Date.now());
              if (ctxEvent) {
                sawContextUsage = true;
                await onEvent(ctxEvent);
              }

              // (3) Fallback snapshot: one request's prompt+response size ≈ what
              // occupies the window. result.modelUsage is *cumulative* across
              // every round-trip in the turn, so cache-read tokens balloon with
              // each tool call and pin the meter to 100% — hence per-request.
              // Subagent (e.g. haiku) messages are skipped so they don't clobber
              // the main conversation's snapshot. The Anthropic message carries a
              // per-request `usage` at runtime even though our local type omits it.
              const u = (aMsg.message as any)?.usage as
                | { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
                | undefined;
              if (u && !aMsg.parent_tool_use_id) {
                const snapshot =
                  (u.input_tokens ?? 0) +
                  (u.cache_read_input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0) +
                  (u.output_tokens ?? 0);
                if (snapshot > 0) lastReqContextTokens = snapshot;
              }
            }

            // The id is assigned at acquisition and already persisted, so this
            // is a tripwire rather than the happy path: if the CLI ever opens a
            // different session than the one it was given, resuming this run
            // would silently target a transcript that does not exist.
            if (msg.session_id && msg.session_id !== cs.state.sessionId) {
              logWarn(
                `Session id mismatch for run ${cs.runId}: asked for ${cs.state.sessionId ?? "none"}, got ${msg.session_id}`,
              );
              cs.state.sessionId = msg.session_id;
              sessionIdMemo.set(cs.runId, msg.session_id);
              runsRepo
                .updateRun(cs.runId, { sessionId: msg.session_id })
                .catch((err) => logError("Failed to persist session ID:", err));
            }

            // Capture stop reason + usage from result messages.
            if (msg.type === "result") {
              const resultMsg = msg as SDKResultMessage;
              if (resultMsg.stop_reason !== undefined) {
                cs.state.lastStopReason = resultMsg.stop_reason;
              }

              let inputTokens = 0,
                outputTokens = 0,
                cacheRead = 0,
                cacheWrite = 0;
              let primaryModel: string | undefined;
              // Fallback context meter: the entry with the largest window is the
              // main conversation model (not haiku subagents).
              let ctxModel: string | undefined;
              let ctxWindow = 0;
              if (resultMsg.modelUsage) {
                for (const [modelName, usage] of Object.entries(resultMsg.modelUsage)) {
                  inputTokens += usage.inputTokens;
                  outputTokens += usage.outputTokens;
                  cacheRead += usage.cacheReadInputTokens;
                  cacheWrite += usage.cacheCreationInputTokens;
                  if (!primaryModel) primaryModel = modelName;
                  const window = usage.contextWindow ?? 0;
                  if (window > ctxWindow) {
                    ctxWindow = window;
                    ctxModel = modelName;
                  }
                }
              }

              cs.state.lastUsage = {
                totalCostUsd: resultMsg.total_cost_usd,
                durationMs: resultMsg.duration_ms,
                numTurns: resultMsg.num_turns,
                inputTokens: inputTokens || undefined,
                outputTokens: outputTokens || undefined,
                cacheReadTokens: cacheRead || undefined,
                cacheWriteTokens: cacheWrite || undefined,
                model: primaryModel,
                modelUsage: resultMsg.modelUsage,
              };

              // Fallback only — an authoritative snapshot already covered the turn.
              if (!sawContextUsage && ctxWindow > 0 && lastReqContextTokens > 0) {
                const total = Math.min(lastReqContextTokens, ctxWindow);
                await onEvent({
                  type: "context_usage",
                  totalTokens: total,
                  maxTokens: ctxWindow,
                  percentage: (total / ctxWindow) * 100,
                  model: ctxModel ?? primaryModel,
                  ts: Date.now(),
                });
              }
            }

            const events = mapSDKMessage(msg, cs);
            for (const event of events) {
              await onEvent(event);

              if (
                event.type === "tool_call" &&
                event.metadata?.phase === "complete" &&
                event.output
              ) {
                for (const artEvent of extractArtifactsFromToolOutput(event.toolName, event.output)) {
                  await onEvent(artEvent);
                }
              }
            }
          }
        })();

        await Promise.race([streamPromise, timeoutPromise]);

        // Replace the provisional goal-derived title with the CLI's
        // auto-generated aiTitle, once, for the initial run only. Fire-and-forget:
        // getSessionInfo reads the persisted transcript independently of the
        // (now-finished) query, so this must not delay the run outcome.
        if (cs.isInitial && cs.state.sessionId) {
          const sessionId = cs.state.sessionId;
          const dir = cs.options.cwd;
          void readAutoTitle(sessionId, dir).then((title) => {
            if (title) {
              runsRepo
                .updateRun(cs.runId, { title })
                .catch((err) => logError("Failed to persist auto title:", err));
            }
          });
        }

        return classifyOutcome({
          stopReason: cs.state.lastStopReason ?? null,
          usage: cs.state.lastUsage,
          terminalToolNonExecutionKind: cs.state.terminalToolNonExecutionKind,
          aborted: signal.aborted,
          timedOut: false,
          errorMessage: undefined,
          timeoutMs: timeout,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Emit interrupted events for any pending tool calls
        const ts = Date.now();
        for (const [toolCallId, toolInfo] of cs.toolCallIndex) {
          await onEvent({
            type: "tool_call",
            toolName: toolInfo.toolName,
            input: toolInfo.input as Record<string, unknown> | undefined,
            error: "Interrupted",
            endedAt: ts,
            metadata: { phase: "complete", toolCallId, interrupted: true },
          });
        }
        cs.toolCallIndex.clear();

        return classifyOutcome({
          stopReason: cs.state.lastStopReason ?? null,
          usage: cs.state.lastUsage,
          terminalToolNonExecutionKind: cs.state.terminalToolNonExecutionKind,
          aborted: signal.aborted || cs.abortController.signal.aborted,
          timedOut,
          errorMessage,
          timeoutMs: timeout,
        });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
      }
    },

    async cleanup(session): Promise<void> {
      // Per-run state lives on the Session object Core is about to drop.
      const cs = session as ClaudeSession;

      // The query normally auto-completes when the stream ends, so this is a
      // backstop: on an aborted or errored run the CLI subprocess can outlive
      // the stream, and nothing else would reap it.
      try {
        cs.query?.close?.();
      } catch (err) {
        logWarn(
          "Failed to close SDK query:",
          err instanceof Error ? err.message : String(err),
        );
      }

      removeClaudeRuntimeSettings(cs.runtimeSettingsPath);
    },

    async canResumeSession(runId: string): Promise<boolean> {
      const sessionId = await lookupSessionId(runId);
      if (!sessionId) return false;
      try {
        await ensureSDK();
        return queryFn !== null;
      } catch {
        return false;
      }
    },

    async deleteSession(runId: string): Promise<void> {
      // Resolve before clearing the memo — lookupSessionId reads it.
      const sessionId = await lookupSessionId(runId);

      // Remove the persisted transcript too. Clearing our own column only makes
      // the session unreachable from Mains; the CLI's `{sessionId}.jsonl` and
      // its subagent-transcript directory would stay on disk forever.
      if (sessionId) {
        try {
          await ensureSDK();
          if (deleteSdkSessionFn) {
            await deleteSdkSessionFn(sessionId);
          } else {
            logWarn("SDK has no deleteSession(); transcript left on disk");
          }
        } catch (err) {
          // A missing session throws — that is the already-deleted case, and it
          // must not block clearing our own reference to it.
          logWarn(
            `Failed to delete SDK session ${sessionId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      sessionIdMemo.delete(runId);
      runsRepo
        .updateRun(runId, { sessionId: null })
        .catch((err) => logError("Failed to clear session ID in DB:", err));
    },

    updateConfig(next) {
      adoptConfig(config, next as ClaudeCodeAdapterConfig);
    },

    async shutdown(): Promise<void> {
      sessionIdMemo.clear();
      sdkLoaded = false;
      loadError = null;
      queryFn = null;
      getSessionInfoFn = null;
      deleteSdkSessionFn = null;
      cachedModels = null;
      cachedModelsTimestamp = 0;
      cachedPlugins = null;
      cachedPluginsTimestamp = 0;
      commandsCache.clear();
      skillsCache.clear();
      logInfo("Shutdown complete");
    },

    async listModels(): Promise<ModelInfo[]> {
      const now = Date.now();
      if (cachedModels && now - cachedModelsTimestamp < MODELS_CACHE_TTL_MS) {
        return cachedModels;
      }

      try {
        await ensureSDK();
        if (!queryFn) {
          logWarn("SDK not available, returning fallback models");
          return getDefaultModels(config.defaultModel);
        }

        let binaryPath: string | null = null;
        if (config.binary) {
          const resolved = resolveCandidate(config.binary);
          if (resolved) binaryPath = resolved;
        }
        if (!binaryPath) binaryPath = findClaudeBinary();
        if (!binaryPath) {
          logWarn("CLI not found, returning fallback models");
          return getDefaultModels(config.defaultModel);
        }

        const tempQuery = queryFn({
          prompt: "",
          options: { pathToClaudeCodeExecutable: binaryPath },
        });

        const sdkModels = await tempQuery.supportedModels();
        if (!sdkModels || sdkModels.length === 0) {
          logWarn("SDK returned no models, using fallback");
          return getDefaultModels(config.defaultModel);
        }

        // Drop the SDK's synthetic "default" entry ("Use the default model
        // (currently …)"). It's redundant with the concrete model it resolves
        // to (Opus 4.8) and just duplicates a row in the picker. Guard against
        // an account whose only offering is "default" so the list never empties.
        const selectableSdkModels =
          sdkModels.length > 1
            ? sdkModels.filter((m) => m.value !== "default")
            : sdkModels;

        const defaultModelId = resolveClaudeDefaultModelId(
          sdkModels,
          config.defaultModel,
        );

        const models: ModelInfo[] = selectableSdkModels.map((sdkModel) => {
          // SDK's .d.ts declares supportsFastMode but the runtime payload doesn't include it.
          // Fast mode is currently meaningful only on opus; this fallback lights it up
          // automatically when the SDK starts surfacing the field.
          const id = sdkModel.value;
          const fallbackFastMode = id === "opus[1m]";
          return {
            id,
            displayName: sdkModel.displayName,
            description: sdkModel.description,
            isDefault: sdkModel.value === defaultModelId,
            capabilities: {
              streaming: true,
              vision: true,
              functionCalling: true,
              reasoning: sdkModel.value.includes("opus"),
            },
            contextWindow: sdkModel.value.includes("haiku") ? 128000 : 200000,
            supportsFastMode: sdkModel.supportsFastMode ?? fallbackFastMode,
            supportsEffort: sdkModel.supportsEffort,
            supportedEffortLevels: sdkModel.supportedEffortLevels,
          };
        });

        cachedModels = models;
        cachedModelsTimestamp = now;
        return models;
      } catch (error) {
        logError("Failed to fetch models from SDK:", error);
        return getDefaultModels(config.defaultModel);
      }
    },

    async listCommands(workspacePath?: string): Promise<CommandInfo[]> {
      const now = Date.now();
      const cacheKey = workspacePath ?? "__global__";
      const cachedEntry = commandsCache.get(cacheKey);
      if (cachedEntry && now - cachedEntry.timestamp < COMMANDS_CACHE_TTL_MS) {
        return cachedEntry.commands;
      }

      try {
        await ensureSDK();
        if (!queryFn) return [];

        let binaryPath: string | null = null;
        if (config.binary) {
          const resolved = resolveCandidate(config.binary);
          if (resolved) binaryPath = resolved;
        }
        if (!binaryPath) binaryPath = findClaudeBinary();
        if (!binaryPath) return [];

        const tempQuery = queryFn({
          prompt: "",
          options: { pathToClaudeCodeExecutable: binaryPath },
        });

        const initResult = await tempQuery.initializationResult();
        if (!initResult?.commands || initResult.commands.length === 0) {
          return [];
        }

        // initializationResult().commands mixes built-in /commands with disk-backed skills.
        // Exclude only skills we discover the same way as the $ menu.
        const diskSkills = await fetchDiskSkills(workspacePath);
        const diskSkillNames = new Set(diskSkills.map((s) => s.name));

        const commands: CommandInfo[] = initResult.commands
          .filter((cmd) => !diskSkillNames.has(cmd.name))
          .map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            argumentHint: cmd.argumentHint,
            userFacing: true,
          }));

        commandsCache.set(cacheKey, { commands, timestamp: now });
        return commands;
      } catch (error) {
        logError("Failed to fetch commands from SDK:", error);
        return [];
      }
    },

    async listSkills(workspacePath?: string): Promise<SkillInfo[]> {
      return fetchDiskSkills(workspacePath);
    },

    async listPlugins(): Promise<PluginListResponse> {
      const now = Date.now();
      if (cachedPlugins && now - cachedPluginsTimestamp < PLUGINS_CACHE_TTL_MS) {
        return cachedPlugins;
      }

      const empty = (remoteSyncError: string | null): PluginListResponse => ({
        marketplaces: [],
        marketplaceLoadErrors: [],
        remoteSyncError,
        featuredPluginIds: [],
      });

      try {
        if (!resolveClaudeBinary()) return empty("Claude CLI not found");

        // `--available` includes the marketplace catalog (and may sync remotely);
        // marketplace list supplies the install locations / ordering.
        const [listRes, mpRes] = await Promise.all([
          runClaudeCli(["plugin", "list", "--json", "--available"], 30000),
          runClaudeCli(["plugin", "marketplace", "list", "--json"], 15000),
        ]);

        const parse = <T>(stdout: string, label: string): T | null => {
          const trimmed = stdout.trim();
          if (!trimmed) return null;
          try {
            return JSON.parse(trimmed) as T;
          } catch (err) {
            logWarn(`Failed to parse ${label} JSON:`, err instanceof Error ? err.message : String(err));
            return null;
          }
        };

        const listJson = parse<{ installed?: unknown[]; available?: unknown[] }>(
          listRes.stdout,
          "plugin list",
        );
        const mpJson = parse<unknown[]>(mpRes.stdout, "marketplace list");

        if (!listJson && !mpJson) {
          const msg = (listRes.stderr || mpRes.stderr || "").trim();
          return empty(msg || null);
        }

        // Manifest fallback for plugins the catalog cache hasn't indexed yet.
        const manifestsByMarketplace: Record<
          string,
          Record<string, Record<string, any>>
        > = {};
        for (const raw of mpJson ?? []) {
          const mp = raw as Record<string, unknown>;
          if (mp && typeof mp.name === "string" && typeof mp.installLocation === "string") {
            manifestsByMarketplace[mp.name] = readMarketplaceManifestPlugins(
              mp.installLocation,
            );
          }
        }

        const result = mapClaudePluginList(
          listJson,
          mpJson,
          readPluginCatalogPlugins(),
          readInstalledShaById(),
          manifestsByMarketplace,
        );
        cachedPlugins = result;
        cachedPluginsTimestamp = now;
        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logError("Failed to list plugins:", msg);
        return empty(msg);
      }
    },

    async readPlugin(pluginName: string, marketplacePath: string): Promise<PluginDetail> {
      // Detail comes from the local catalog cache (written by `plugin list
      // --available`), which carries components + cost for installed AND
      // not-installed plugins — the `plugin details` CLI command has no JSON
      // output, so disk is the robust source. installed/enabled is overlaid
      // from the cached list when available, else from installed_plugins.json.
      const catalogPlugins = readPluginCatalogPlugins();
      const installedEnabled: Record<string, boolean> = {};
      if (cachedPlugins) {
        for (const mp of cachedPlugins.marketplaces) {
          for (const p of mp.plugins) {
            if (p.installed) installedEnabled[p.id] = p.enabled;
          }
        }
      } else {
        for (const id of readInstalledPluginIds()) installedEnabled[id] = true;
      }
      const manifestEntry =
        readMarketplaceManifestPlugins(marketplacePath)[pluginName] ?? null;
      return mapClaudePluginDetail(
        catalogPlugins,
        installedEnabled,
        pluginName,
        marketplacePath,
        manifestEntry,
      );
    },

    async installPlugin(pluginId: string, scope?: "user" | "project" | "local"): Promise<void> {
      // pluginId is "name@marketplace"; the CLI accepts it directly. Default
      // scope is "user" (global); install also enables by default.
      const args = ["plugin", "install", pluginId];
      if (scope) args.push("--scope", scope);
      const { stdout, stderr, code } = await runClaudeCli(args, 120000);
      if (code !== 0) {
        throw new Error(`Plugin install failed: ${(stderr || stdout).trim() || `exit code ${code}`}`);
      }
      invalidatePluginCaches();
    },

    async uninstallPlugin(pluginId: string): Promise<void> {
      // Match the scope the plugin was installed at (defaults to "user"); -y
      // skips the prune confirmation prompt in the non-TTY subprocess. local/
      // project scope resolves relative to cwd → run in the install dir.
      const loc = getInstalledPluginLocation(pluginId);
      const cwd = resolveScopeCwd(loc);
      const args = ["plugin", "uninstall", pluginId, "-y"];
      if (loc?.scope) args.push("--scope", loc.scope);
      const { stdout, stderr, code } = await runClaudeCli(args, 120000, cwd);
      if (code !== 0) {
        throw new Error(`Plugin uninstall failed: ${(stderr || stdout).trim() || `exit code ${code}`}`);
      }
      invalidatePluginCaches();
    },

    async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
      // `claude plugin enable|disable <id> [--scope]`. Match the installed scope
      // and run local/project ops in the dir the plugin was installed from.
      const loc = getInstalledPluginLocation(pluginId);
      const cwd = resolveScopeCwd(loc);
      const args = ["plugin", enabled ? "enable" : "disable", pluginId];
      if (loc?.scope) args.push("--scope", loc.scope);
      const { stdout, stderr, code } = await runClaudeCli(args, 60000, cwd);
      if (code !== 0) {
        throw new Error(
          `Plugin ${enabled ? "enable" : "disable"} failed: ${(stderr || stdout).trim() || `exit code ${code}`}`,
        );
      }
      invalidatePluginCaches();
    },

    async updatePlugin(pluginId: string): Promise<void> {
      const { stdout, stderr, code } = await runClaudeCli(["plugin", "update", pluginId], 120000);
      if (code !== 0) {
        throw new Error(`Plugin update failed: ${(stderr || stdout).trim() || `exit code ${code}`}`);
      }
      invalidatePluginCaches();
    },

    async getAccountInfo(): Promise<AccountInfo> {
      const cli = { version: await getClaudeVersion(), channel: null, outdated: false };

      // Fast path: read login state straight from the CLI — detects the
      // signed-out case definitively and skips spawning an SDK query process.
      const fromAuthStatus = await readAccountFromAuthStatus();
      if (fromAuthStatus !== undefined) {
        return { account: fromAuthStatus, requiresOpenaiAuth: false, cli };
      }

      // Legacy fallback (CLI without `auth status`): read the account via a
      // lightweight control query (same pattern as listModels — prompt:""
      // never sends a turn). Falls back to no account.
      let account: AccountInfo["account"] = null;
      try {
        await ensureSDK();
        const binaryPath = resolveClaudeBinary();
        if (queryFn && binaryPath) {
          const tempQuery = queryFn({
            prompt: "",
            options: { pathToClaudeCodeExecutable: binaryPath },
          });
          try {
            const info = await tempQuery.accountInfo();
            if (info?.email) {
              account = {
                type: "claude",
                email: info.email,
                planType: info.subscriptionType ?? info.organization ?? "",
              };
            } else if (info?.apiKeySource || info?.tokenSource) {
              account = { type: "apiKey" };
            }
          } finally {
            await tempQuery.interrupt().catch(() => {});
          }
        }
      } catch (error) {
        logWarn(
          `getAccountInfo: account read failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return { account, requiresOpenaiAuth: false, cli };
    },

    async updateCli(): Promise<CliUpdateResult> {
      const { stdout, stderr, code } = await runClaudeCli(["update"], 120000);
      return { success: code === 0, output: `${stdout}${stderr}`.trim() };
    },

    // The Claude Code CLI only writes its own auto-title (aiTitle) into the
    // transcript in *interactive* mode — headless SDK query() runs never do, so
    // reading it back (see executePrompt → readAutoTitle) returns nothing for
    // app runs. Generate the title ourselves with a cheap one-shot model call,
    // mirroring the codex driver. runs.service calls this at run start;
    // readAutoTitle stays as a best-effort upgrade if a real aiTitle ever lands.
    async generateTitle(goal: string, context?: WorkRunContextItem[]): Promise<string> {
      try {
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
          "Generate a concise title (2-5 words) that summarizes what the user wants.",
          "Rules:",
          "- Reply with ONLY the title text, nothing else",
          '- Use title case: capitalize the first letter of each word, e.g. "Fix Login Redirect", "Add Dark Mode", "Hello Greeting"',
          '- Do NOT use generic descriptions of the request type, e.g. NOT "Title Generation"',
          "- No quotes, no punctuation at the end, no prefixes",
          "",
          `User message: ${goal}`,
          contextSnippet ? `\nContext:\n${contextSnippet}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const raw = await generateOneShotText(titlePrompt, {
          system:
            "You write short, descriptive titles. Output only the title text, nothing else.",
        });
        return cleanGeneratedTitle(raw, goal);
      } catch (err) {
        logWarn("Title generation failed, using fallback:", err);
        return goal.slice(0, 50);
      }
    },

    async generateText(
      prompt: string,
      opts?: { system?: string; model?: string },
    ): Promise<string> {
      return generateOneShotText(prompt, opts);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Module-level helpers (no closure dependencies)
// ─────────────────────────────────────────────────────────────

async function discoverSkillsFromDirectory(
  skillsDir: string,
  source: "user" | "project",
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  try {
    if (!fs.existsSync(skillsDir)) return skills;

    const stat = fs.statSync(skillsDir);
    if (!stat.isDirectory()) return skills;

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const skill = parseSkillFile(skillMdPath, entry.name, source);
        if (skill) skills.push(skill);
      } catch (err) {
        console.warn(`[ClaudeDriver] Failed to parse skill ${entry.name}:`, err);
      }
    }
  } catch (err) {
    console.warn(`[ClaudeDriver] Failed to read skills directory ${skillsDir}:`, err);
  }
  return skills;
}

function parseSkillFile(
  filePath: string,
  dirName: string,
  source: "user" | "project",
): SkillInfo | null {
  const content = fs.readFileSync(filePath, "utf-8");

  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    const firstParagraph = content.trim().split("\n\n")[0]?.trim();
    return {
      name: dirName,
      description: firstParagraph?.substring(0, 200),
      source,
      path: filePath,
      userInvokable: true,
      modelInvocable: true,
    };
  }

  const frontmatter = frontmatterMatch[1];
  const parsed = parseSimpleYaml(frontmatter);

  const skill: SkillInfo = {
    name: (parsed.name as string) || dirName,
    description: parsed.description as string | undefined,
    argumentHint: parsed["argument-hint"] as string | undefined,
    userInvokable: parsed["user-invokable"] !== false,
    modelInvocable: parsed["disable-model-invocation"] !== true,
    source,
    model: parsed.model as string | undefined,
    forked: parsed.context === "fork",
    agent: parsed.agent as string | undefined,
    path: filePath,
  };

  if (!skill.description) {
    const bodyContent = content.slice(frontmatterMatch[0].length).trim();
    const firstParagraph = bodyContent.split("\n\n")[0]?.trim();
    if (firstParagraph && !firstParagraph.startsWith("#")) {
      skill.description = firstParagraph.substring(0, 200);
    }
  }

  return skill;
}

export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Skill frontmatter fields are top-level scalars. Indented lines belong to
    // a block scalar (handled below) or to metadata we do not consume here.
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent > 0) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value: unknown = trimmed.slice(colonIndex + 1).trim();
    const blockStyle = (value as string).match(/^([>|])[+-]?(?:\s+#.*)?$/);

    if (blockStyle) {
      const blockLines: string[] = [];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex];
        const nextTrimmed = nextLine.trim();
        const nextIndent = nextLine.length - nextLine.trimStart().length;

        if (nextTrimmed && nextIndent <= lineIndent) break;

        blockLines.push(nextLine);
        nextIndex += 1;
      }

      const contentIndent = blockLines.reduce((smallest, blockLine) => {
        if (!blockLine.trim()) return smallest;
        const indent = blockLine.length - blockLine.trimStart().length;
        return Math.min(smallest, indent);
      }, Number.POSITIVE_INFINITY);
      const normalizedLines = blockLines.map((blockLine) =>
        blockLine.trim() && Number.isFinite(contentIndent)
          ? blockLine.slice(contentIndent)
          : "",
      );

      value =
        blockStyle[1] === "|"
          ? normalizedLines.join("\n").trim()
          : normalizedLines
              .reduce((folded, blockLine) => {
                if (!blockLine.trim()) return `${folded.trimEnd()}\n`;
                if (!folded || folded.endsWith("\n")) return folded + blockLine.trim();
                return `${folded} ${blockLine.trim()}`;
              }, "")
              .trim();
      index = nextIndex - 1;
    } else if (
      ((value as string).startsWith('"') && (value as string).endsWith('"')) ||
      ((value as string).startsWith("'") && (value as string).endsWith("'"))
    ) {
      value = (value as string).slice(1, -1);
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (value === "") {
      value = undefined;
    }

    result[key] = value;
  }

  return result;
}

function readMcpServersFromSettings(
  settingSources: Array<"user" | "project" | "local">,
  workspacePath?: string,
): Record<string, McpServerConfig> {
  const mergedServers: Record<string, McpServerConfig> = {};

  if (settingSources.includes("user")) {
    const userSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const userServers = readMcpServersFromFile(userSettingsPath);
    if (userServers) Object.assign(mergedServers, userServers);

    const claudeJsonPath = path.join(os.homedir(), ".claude.json");
    const claudeJsonServers = readMcpServersFromFile(claudeJsonPath);
    if (claudeJsonServers) Object.assign(mergedServers, claudeJsonServers);
  }

  if (settingSources.includes("project") && workspacePath) {
    const projectSettingsPath = path.join(workspacePath, ".claude", "settings.json");
    const projectServers = readMcpServersFromFile(projectSettingsPath);
    if (projectServers) Object.assign(mergedServers, projectServers);

    const mcpJsonPath = path.join(workspacePath, ".mcp.json");
    const mcpJsonServers = readMcpServersFromFile(mcpJsonPath);
    if (mcpJsonServers) Object.assign(mergedServers, mcpJsonServers);
  }

  if (settingSources.includes("local") && workspacePath) {
    const localSettingsPath = path.join(workspacePath, ".claude", "settings.local.json");
    const localServers = readMcpServersFromFile(localSettingsPath);
    if (localServers) Object.assign(mergedServers, localServers);
  }

  return mergedServers;
}

function readMcpServersFromFile(
  filePath: string,
): Record<string, McpServerConfig> | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    const settings = JSON.parse(content);
    const servers = settings.mcpServers || settings;

    if (!servers || typeof servers !== "object") return null;

    const validServers: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(servers)) {
      if (isValidMcpServerConfig(cfg)) {
        validServers[name] = cfg as McpServerConfig;
      }
    }

    return Object.keys(validServers).length > 0 ? validServers : null;
  } catch (err) {
    console.warn(`[ClaudeDriver] Failed to read MCP servers from ${filePath}:`, err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Plugin disk readers (read the Claude CLI's local plugin metadata files)
// ─────────────────────────────────────────────────────────────

function readJsonFileSafe(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function pluginsDir(): string {
  return path.join(os.homedir(), ".claude", "plugins");
}

/** `catalog.plugins` from plugin-catalog-cache.json ({} when unavailable). */
function readPluginCatalogPlugins(): Record<string, unknown> {
  const data = readJsonFileSafe(path.join(pluginsDir(), "plugin-catalog-cache.json"));
  const plugins = data?.catalog?.plugins;
  return plugins && typeof plugins === "object" ? plugins : {};
}

/**
 * Plugin entries from a cloned marketplace's `.claude-plugin/marketplace.json`,
 * keyed by plugin name. Fallback metadata source for plugins the catalog cache
 * hasn't indexed yet — the cache lags the manifest, so newly added marketplace
 * plugins (author/category/homepage) appear here first.
 */
function readMarketplaceManifestPlugins(
  marketplacePath: string,
): Record<string, Record<string, any>> {
  if (!marketplacePath) return {};
  const data = readJsonFileSafe(
    path.join(marketplacePath, ".claude-plugin", "marketplace.json"),
  );
  const out: Record<string, Record<string, any>> = {};
  for (const raw of Array.isArray(data?.plugins) ? data.plugins : []) {
    if (raw && typeof raw === "object" && typeof raw.name === "string") {
      out[raw.name] = raw as Record<string, any>;
    }
  }
  return out;
}

/** Installed plugin ids (keys of installed_plugins.json). */
function readInstalledPluginIds(): string[] {
  const data = readJsonFileSafe(path.join(pluginsDir(), "installed_plugins.json"));
  const plugins = data?.plugins;
  return plugins && typeof plugins === "object" ? Object.keys(plugins) : [];
}

/** pluginId → installed git commit sha (first entry), for update detection. */
function readInstalledShaById(): Record<string, string> {
  const data = readJsonFileSafe(path.join(pluginsDir(), "installed_plugins.json"));
  const plugins = data?.plugins;
  const out: Record<string, string> = {};
  if (plugins && typeof plugins === "object") {
    for (const [id, entries] of Object.entries(plugins)) {
      const sha = Array.isArray(entries) ? entries[0]?.gitCommitSha : undefined;
      if (typeof sha === "string") out[id] = sha;
    }
  }
  return out;
}

/** Scope + project dir the plugin was installed at (first entry), or null.
 *  projectPath is set for project/local scope and is needed as the CLI cwd so
 *  enable/disable/uninstall resolve the scope against the right directory. */
function getInstalledPluginLocation(
  pluginId: string,
): { scope: string; projectPath?: string } | null {
  const data = readJsonFileSafe(path.join(pluginsDir(), "installed_plugins.json"));
  const entries = data?.plugins?.[pluginId];
  const e = Array.isArray(entries) ? entries[0] : undefined;
  if (e?.scope) {
    return {
      scope: String(e.scope),
      projectPath: typeof e.projectPath === "string" ? e.projectPath : undefined,
    };
  }
  return null;
}

/**
 * cwd to run a scope-sensitive plugin op (enable/disable/uninstall) in.
 * - user scope: undefined (global, cwd-independent).
 * - project/local scope: the install dir, which must still exist — the CLI
 *   resolves the scope against cwd and spawn() ENOENTs on a missing dir.
 * Throws a clear error when the install dir is gone (orphaned plugin).
 */
function resolveScopeCwd(loc: { scope: string; projectPath?: string } | null): string | undefined {
  if (!loc || loc.scope === "user") return undefined;
  if (loc.projectPath && fs.existsSync(loc.projectPath)) return loc.projectPath;
  throw new Error(
    `This plugin was installed in "${loc.projectPath ?? "an unknown directory"}" (${loc.scope} scope), ` +
      `which no longer exists. Re-create that directory to manage it, or remove the plugin manually.`,
  );
}

function isValidMcpServerConfig(cfg: unknown): boolean {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as Record<string, unknown>;
  if (c.type === undefined || c.type === "stdio") {
    return typeof c.command === "string" && c.command.length > 0;
  }
  if (c.type === "http" || c.type === "sse") {
    return typeof c.url === "string" && c.url.length > 0;
  }
  return false;
}

/**
 * Offline fallback picker, used only when the SDK or the CLI binary is missing
 * — the live `supportedModels()` list is the real catalogue.
 *
 * Display names are deliberately version-free: the CLI aliases below always
 * resolve to the current generation, so spelling a version here only rots (this
 * list read "Claude Opus 4.8" long after Opus 5 shipped). Effort levels are the
 * conservative common set for the same reason.
 */
function getDefaultModels(defaultModel?: string): ModelInfo[] {
  const models: Array<Omit<ModelInfo, "isDefault">> = [
    {
      id: "fable",
      displayName: "Claude Fable",
      capabilities: { streaming: true, vision: true, functionCalling: true, reasoning: true },
      contextWindow: 200000,
      supportsFastMode: false,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "sonnet",
      displayName: "Claude Sonnet",
      capabilities: { streaming: true, vision: true, functionCalling: true },
      contextWindow: 200000,
      supportsFastMode: true,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
    },
    {
      id: "opus[1m]",
      displayName: "Claude Opus [1M]",
      capabilities: { streaming: true, vision: true, functionCalling: true, reasoning: true },
      contextWindow: 1000000,
      supportsFastMode: true,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "haiku",
      displayName: "Claude Haiku",
      capabilities: { streaming: true, vision: true, functionCalling: true },
      contextWindow: 200000,
      supportsFastMode: false,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
    },
  ];
  const defaultId = resolveCatalogDefaultId(
    models.map((m) => m.id),
    defaultModel,
    ["sonnet"],
  );
  return models.map((m) => ({ ...m, isDefault: m.id === defaultId }));
}

// ─────────────────────────────────────────────────────────────
// Pure helpers exported for testing
// ─────────────────────────────────────────────────────────────

/**
 * Decide which SDK model the picker should mark as default.
 *
 * A configured `providers.defaultModel` wins only while the SDK still offers
 * it — a pinned id that has aged out (the seed shipped `claude-opus-4-8`, which
 * is an API id and never matched an SDK alias at all) must not leave the
 * catalogue with no default. Otherwise fall back to the SDK's synthetic
 * "default" entry, which names the concrete model the CLI resolves to
 * ("Use the default model (currently …)"); we drop that entry from the picker,
 * but its text is the only signal for the CLI's own choice. Longest display
 * name wins so "Claude Opus [1M]" beats "Claude Opus" on the same hint.
 * Failing both, the SDK lists models in preference order — take the first.
 */
export function resolveClaudeDefaultModelId(
  sdkModels: Array<{ value: string; displayName?: string; description?: string }>,
  configuredDefault?: string,
): string | undefined {
  const selectable = sdkModels.filter((m) => m.value !== "default");
  const pool = selectable.length > 0 ? selectable : sdkModels;
  if (configuredDefault && pool.some((m) => m.value === configuredDefault)) {
    return configuredDefault;
  }

  const synthetic = sdkModels.find((m) => m.value === "default");
  const hint = `${synthetic?.displayName ?? ""} ${synthetic?.description ?? ""}`
    .trim()
    .toLowerCase();
  if (hint) {
    let namedId: string | undefined;
    let namedLength = 0;
    for (const model of pool) {
      const name = model.displayName?.trim().toLowerCase();
      if (!name || !hint.includes(name)) continue;
      if (name.length > namedLength) {
        namedId = model.value;
        namedLength = name.length;
      }
    }
    if (namedId) return namedId;
  }

  return pool[0]?.value;
}

/**
 * Map the `claude plugin list --json --available` payload plus
 * `claude plugin marketplace list --json` into the app's marketplace-centric
 * PluginListResponse. Pure: no SDK/CLI access, exposed for tests.
 *
 * The CLI shapes:
 *   list:        { installed: [{ id, enabled, installPath, scope, ... }],
 *                  available: [{ pluginId, name, description, marketplaceName,
 *                               source: { source, url, path, ... } }] }
 *   marketplaces: [{ name, source, repo, installLocation }]
 */
export function mapClaudePluginList(
  list: { installed?: unknown[]; available?: unknown[] } | null,
  marketplaces: unknown[] | null,
  catalogPlugins: Record<string, unknown> = {},
  installedShaById: Record<string, string> = {},
  manifestsByMarketplace: Record<string, Record<string, Record<string, any>>> = {},
): PluginListResponse {
  // Index installed plugins by id for installed/enabled lookup.
  const installedById = new Map<string, { enabled: boolean; installPath?: string }>();
  for (const raw of list?.installed ?? []) {
    const p = raw as Record<string, unknown>;
    if (p && typeof p.id === "string") {
      installedById.set(p.id, {
        enabled: p.enabled === true,
        installPath: typeof p.installPath === "string" ? p.installPath : undefined,
      });
    }
  }

  // Marketplace skeletons (preserve CLI order); lazily created for ids that
  // reference a marketplace not in the configured list.
  const marketplaceByName = new Map<string, MarketplaceInfo>();
  for (const raw of marketplaces ?? []) {
    const mp = raw as Record<string, unknown>;
    if (!mp || typeof mp.name !== "string") continue;
    marketplaceByName.set(mp.name, {
      name: mp.name,
      path: typeof mp.installLocation === "string" ? mp.installLocation : "",
      interface: null,
      plugins: [],
    });
  }
  const ensureMarketplace = (name: string): MarketplaceInfo => {
    let mp = marketplaceByName.get(name);
    if (!mp) {
      mp = { name, path: "", interface: null, plugins: [] };
      marketplaceByName.set(name, mp);
    }
    return mp;
  };

  const covered = new Set<string>();

  for (const raw of list?.available ?? []) {
    const a = raw as Record<string, unknown>;
    if (!a || typeof a.pluginId !== "string") continue;
    const id = a.pluginId;
    const marketplaceName =
      (typeof a.marketplaceName === "string" && a.marketplaceName) || id.split("@")[1] || "unknown";
    const inst = installedById.get(id);
    const src = (a.source as Record<string, unknown>) ?? {};
    const name = typeof a.name === "string" ? a.name : id.split("@")[0];
    // Enrich category/developer/homepage from the catalog cache (the
    // `--available` payload omits them) so the UI can group by category.
    // The cloned marketplace.json is the fallback: the catalog cache lags the
    // manifest, so newly added plugins only carry metadata there.
    const catEntry = catalogPlugins[id] as Record<string, any> | undefined;
    const me = (catEntry?.marketplace_entry as Record<string, any>) ?? {};
    const mf = manifestsByMarketplace[marketplaceName]?.[name] ?? {};
    const mfAuthor =
      typeof mf.author === "string" ? mf.author : (mf.author?.name as string | undefined);
    const desc =
      (typeof a.description === "string" && a.description) ||
      (typeof me.description === "string" ? me.description : undefined) ||
      (typeof mf.description === "string" ? mf.description : undefined);
    const category =
      typeof me.category === "string"
        ? me.category
        : typeof mf.category === "string"
          ? mf.category
          : undefined;
    const developerName =
      typeof me.author?.name === "string" ? me.author.name : mfAuthor;
    const websiteUrl =
      typeof me.homepage === "string"
        ? me.homepage
        : typeof mf.homepage === "string"
          ? mf.homepage
          : undefined;
    const displayName = typeof me.displayName === "string" ? me.displayName : undefined;
    const installs =
      typeof a.installCount === "number"
        ? a.installCount
        : typeof catEntry?.unique_installs === "number"
          ? (catEntry.unique_installs as number)
          : undefined;
    // Only flag updates when the catalog reports a concrete latest sha that
    // differs from what's installed — `source_sha` alone is unreliable.
    const catSha = typeof catEntry?.sha === "string" ? (catEntry.sha as string) : undefined;
    const installedSha = installedShaById[id];
    const updateAvailable = !!inst && !!catSha && !!installedSha && catSha !== installedSha;
    ensureMarketplace(marketplaceName).plugins.push({
      id,
      name,
      source: {
        type: (src.source as string) ?? "git",
        path: (src.url as string) ?? (src.path as string) ?? "",
      },
      installed: !!inst,
      enabled: inst?.enabled ?? false,
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      installs,
      updateAvailable,
      // Most Claude plugins are slug-named with no displayName, so the UI
      // humanizes the raw `name` ("agent-sdk-dev" → "Agent SDK Dev"); a real
      // marketplace displayName (rare) is preferred when present. No icon/logo
      // data exists in Claude's plugin metadata — the UI falls back to a letter
      // avatar.
      interface:
        displayName || desc || category || developerName
          ? {
              displayName,
              shortDescription: desc,
              longDescription: desc,
              category,
              developerName,
              websiteUrl,
              capabilities: [],
              screenshots: [],
            }
          : null,
    });
    covered.add(id);
  }

  // Installed plugins absent from the catalog (local-only, or marketplace
  // removed) — surface under their id-derived marketplace so they're visible.
  for (const [id, inst] of installedById) {
    if (covered.has(id)) continue;
    const marketplaceName = id.split("@")[1] || "local";
    ensureMarketplace(marketplaceName).plugins.push({
      id,
      name: id.split("@")[0],
      source: { type: "local", path: inst.installPath ?? "" },
      installed: true,
      enabled: inst.enabled,
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      interface: null,
    });
  }

  return {
    marketplaces: Array.from(marketplaceByName.values()),
    marketplaceLoadErrors: [],
    remoteSyncError: null,
    featuredPluginIds: [],
  };
}

/**
 * Build a PluginDetail from the local plugin catalog cache. Pure: takes the
 * already-read `catalog.plugins` map and an installed→enabled overlay, resolves
 * the plugin id from (name, marketplacePath), and maps components. Exposed for
 * tests.
 */
export function mapClaudePluginDetail(
  catalogPlugins: Record<string, unknown>,
  installedEnabled: Record<string, boolean>,
  pluginName: string,
  marketplacePath: string,
  manifestEntry: Record<string, any> | null = null,
): PluginDetail {
  const marketplaceName = marketplacePath ? path.basename(marketplacePath) : "";
  let pluginId = marketplaceName ? `${pluginName}@${marketplaceName}` : "";
  let entry = pluginId ? (catalogPlugins[pluginId] as Record<string, any> | undefined) : undefined;
  if (!entry) {
    // Fallback: match by plugin name across marketplaces.
    const key = Object.keys(catalogPlugins).find((k) => k.split("@")[0] === pluginName);
    if (key) {
      pluginId = key;
      entry = catalogPlugins[key] as Record<string, any>;
    }
  }
  if (!pluginId) pluginId = `${pluginName}@${marketplaceName || "unknown"}`;

  // The catalog cache entry wins; the marketplace.json manifest entry fills
  // the gaps for plugins the cache hasn't indexed yet.
  const me = (entry?.marketplace_entry as Record<string, any>) ?? {};
  const mf = manifestEntry ?? {};
  const comps = (entry?.components as Record<string, any>) ?? {};
  const rawAuthor = me.author ?? mf.author;
  const authorName =
    typeof rawAuthor === "string" ? rawAuthor : (rawAuthor?.name as string | undefined);
  const description =
    (typeof me.description === "string" ? me.description : null) ??
    (typeof mf.description === "string" ? mf.description : null);
  const category =
    typeof me.category === "string"
      ? me.category
      : typeof mf.category === "string"
        ? mf.category
        : undefined;
  const homepage =
    typeof me.homepage === "string"
      ? me.homepage
      : typeof mf.homepage === "string"
        ? mf.homepage
        : undefined;
  const manifestSourceUrl =
    typeof mf.source === "string" ? mf.source : (mf.source?.url as string | undefined);
  const installed = pluginId in installedEnabled;
  const enabled = installedEnabled[pluginId] ?? false;
  const resolvedMarketplace = marketplaceName || pluginId.split("@")[1] || "";

  const skills = (Array.isArray(comps.skills) ? comps.skills : [])
    .map((s: any) => ({ name: (typeof s === "string" ? s : (s?.name as string)) ?? "", enabled: true }))
    .filter((s: { name: string }) => s.name.length > 0);

  const mcpServers = (Array.isArray(comps.mcpServers) ? comps.mcpServers : [])
    .map((m: any) => (typeof m === "string" ? m : (m?.name as string)))
    .filter(Boolean) as string[];

  return {
    marketplaceName: resolvedMarketplace,
    marketplacePath,
    summary: {
      id: pluginId,
      name: pluginName,
      source: {
        type: "git",
        path: homepage ?? (me.source as string) ?? manifestSourceUrl ?? "",
      },
      installed,
      enabled,
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      interface: {
        displayName: (me.name as string) ?? pluginName,
        shortDescription: description ?? undefined,
        longDescription: description ?? undefined,
        developerName: authorName,
        category,
        capabilities: [],
        websiteUrl: homepage,
        screenshots: [],
      },
    },
    description,
    skills,
    apps: [],
    mcpServers,
    uniqueInstalls:
      typeof entry?.unique_installs === "number" ? (entry.unique_installs as number) : null,
    lastUpdated:
      typeof entry?.last_updated === "string" ? (entry.last_updated as string) : null,
  };
}

/**
 * Translate the streaming outcome (stop reason / abort flags / error / timeout)
 * into a DriverOutcome. Pure: no SDK access, exposed for tests.
 */
/**
 * Normalize a model-generated run title: keep the first line, strip a leading
 * "title:" label, surrounding quotes/backticks, and trailing sentence
 * punctuation, then cap at 50 chars. Falls back to the goal text when the model
 * returns nothing usable. Mirrors the codex driver's title cleanup.
 */
export function cleanGeneratedTitle(raw: string, fallbackGoal: string): string {
  const cleaned = (raw || "")
    .split("\n")[0]
    .trim()
    .replace(/^title:\s*/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/[.!?]$/, "")
    .trim();
  return (cleaned || fallbackGoal.trim()).slice(0, 50);
}

export function classifyOutcome(args: {
  stopReason: string | null;
  usage?: WorkRunUsage;
  terminalToolNonExecutionKind?: string;
  aborted: boolean;
  timedOut: boolean;
  errorMessage?: string;
  timeoutMs: number;
}): DriverOutcome {
  const {
    stopReason: rawStopReason,
    usage,
    terminalToolNonExecutionKind,
    aborted,
    timedOut,
    errorMessage,
    timeoutMs,
  } = args;
  // DriverOutcome.stopReason is `string | undefined`; coerce null → undefined.
  const stopReason = rawStopReason ?? undefined;

  // Success path: no error, stopReason indicates normal completion (or undefined).
  if (!errorMessage && !timedOut && !aborted) {
    if (stopReason === "refusal") {
      return {
        status: "failed",
        summary: "The model declined to fulfill this request.",
        stopReason,
        usage,
      };
    }
    if (terminalToolNonExecutionKind === "cancelled") {
      return {
        status: "failed",
        summary: "Tool execution was cancelled before the run could complete.",
        stopReason,
        usage,
      };
    }
    return {
      status: "succeeded",
      summary: "Completed successfully",
      stopReason,
      usage,
    };
  }

  // Aborted (signal fired) takes precedence over timeout — Core fired the signal.
  if (aborted && !timedOut) {
    return { status: "canceled", summary: "Run was aborted", stopReason, usage };
  }

  if (timedOut) {
    return {
      status: "failed",
      summary: `Request timed out after ${timeoutMs / 1000} seconds.`,
      stopReason,
      usage,
    };
  }

  // Generic error path
  if (errorMessage) {
    if (errorMessage.includes("timed out")) {
      return {
        status: "failed",
        summary: `Request timed out after ${timeoutMs / 1000} seconds.`,
        stopReason,
        usage,
      };
    }
    if (errorMessage.includes("aborted")) {
      return { status: "canceled", summary: "Run was aborted", stopReason, usage };
    }
    return { status: "failed", summary: errorMessage, stopReason, usage };
  }

  // Fallthrough
  return { status: "failed", summary: "Unknown error", stopReason, usage };
}
