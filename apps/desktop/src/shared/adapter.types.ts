// ─────────────────────────────────────────────────────────────
// Work Run Adapter Types
// Agent/work runtime oriented interfaces for code-writing flows
// ─────────────────────────────────────────────────────────────

import type { ClaudePermissionMode } from "./claude-permission-modes";
import type { ModeId } from "./modes";
import type { ModeToolPolicy } from "./mode-harness";
import type {
  PluginAvailability,
  PluginDisabledReason,
} from "./plugin-install-availability";

/**
 * Per-run tool policy (see `src/shared/mode-harness.ts`). Applied by the
 * drivers with an allowlist mechanism (claude, copilot); codex/cursor enforce
 * their harness through `configSnapshot` (sandbox / agent mode) instead.
 */
export type WorkRunToolPolicy = ModeToolPolicy;

/**
 * Context item provided to a work run
 */
export interface WorkRunContextItem {
  kind: "file" | "diff" | "selection" | "note";
  /** Reference (e.g., file path, commit hash) */
  ref?: string;
  /** Inline content */
  content?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A file attachment serialized for IPC transport (base64-encoded data).
 * Re-exported from runs.dto for adapter-level use.
 */
export interface FileAttachment {
  name: string;
  type: "image" | "document";
  /** Base64-encoded data — optional when `sourcePath` is provided. */
  data?: string;
  /** Absolute path to an existing on-disk file. Preferred over `data` to avoid base64 in memory. */
  sourcePath?: string;
  mimeType: string;
}

/**
 * The filesystem context every coding-agent adapter needs. A real domain
 * Workspace is optional, but a resolved cwd is never implicit.
 */
export interface RunExecutionContext {
  cwd: string;
  workspaceId: string | null;
}

/**
 * Request to start a work run
 */
export interface WorkRunRequest {
  runId: string;
  accountId: string;
  execution: RunExecutionContext;
  goal: string;
  model?: string | null;
  systemPrompt?: string | null;
  /** Experience mode snapshot for this run (see `src/shared/modes.ts`). */
  mode?: ModeId;
  /**
   * Mode-resolved instruction delta (see `src/shared/mode-harness.ts`).
   * Adapters attach it via their provider's native prompt-layer mechanism.
   */
  extraInstructions?: string | null;
  context?: WorkRunContextItem[];
  toolPolicy?: WorkRunToolPolicy | null;
  /**
   * Per-run config snapshot. Adapters use these values to override their
   * cached provider config when present (e.g. Pulse forces specific
   * permission/sandbox/mode regardless of the user's current provider settings).
   * Recognised keys: permissionMode, sandboxMode, mode, thinkingMode, effortLevel,
   * modelReasoningEffort.
   */
  configSnapshot?: Record<string, unknown> | null;
  /** File attachments (images/documents) to include in the prompt */
  attachments?: FileAttachment[];
  /** Structured context issues passed from the UI */
  contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
  /** Structured context signals (error reports) passed from the UI */
  contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
  /** Structured context files passed from the UI */
  contextFiles?: Array<{ path: string }>;
  /** User-selected skills to invoke during this run (adapter decides how to inject) */
  skills?: Array<{
    name: string;
    path?: string;
    displayName?: string;
    description?: string;
    shortDescription?: string;
    iconSmall?: string;
    iconLarge?: string;
    brandColor?: string;
    scope?: string;
  }>;
  /**
   * Per-run hooks configuration that overrides or extends adapter-level hooks.
   * Useful for dynamic hook configuration based on the specific run context.
   */
  hooks?: HooksConfig;
  /**
   * Per-run subagents configuration that extends adapter-level agents.
   * Useful for defining task-specific subagents or overriding existing ones.
   *
   * Note: Include 'Task' in allowedTools to enable subagent invocation.
   */
  agents?: AgentsConfig;
}

/**
 * Log event emitted during a run
 */
export interface WorkRunLogEvent {
  type: "log";
  message: string;
  level?: "info" | "warn" | "error" | "resume" | "start" | "end" | "sdk-user";
  ts?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Tool call event emitted during a run
 */
export interface WorkRunToolCallEvent {
  type: "tool_call";
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  /** Explicit terminal status when absence of an error does not mean success. */
  terminalStatus?: "done" | "error" | "canceled";
  startedAt?: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}


/**
 * Artifact produced during a run
 */
export interface WorkRunArtifactEvent {
  type: "artifact";
  kind: "patch" | "file" | "log" | "report" | "command_result" | "user-prompt" | string;
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  /** When true, pushed to renderer but NOT persisted to DB */
  ephemeral?: boolean;
  /** Identifies the streaming source — renderer uses this to accumulate deltas */
  streamId?: string;
  ts?: number;
}

/**
 * Status change event emitted during a run
 */
export interface WorkRunStatusEvent {
  type: "status";
  status: "running" | "succeeded" | "failed" | "canceled";
  error?: string;
  ts?: number;
}

/**
 * Subagent lifecycle event emitted when a subagent is invoked or completes
 */
export interface WorkRunSubagentEvent {
  type: "subagent";
  /**
   * The lifecycle phase of the subagent. `stopped` is a non-success terminal
   * state that is not the agent's own failure — e.g. a Codex collab agent
   * interrupted by the user or the parent.
   */
  phase: "invoked" | "running" | "completed" | "failed" | "stopped";
  /** The name/type of the subagent (e.g., "code-reviewer", "general-purpose") */
  agentType: string;
  /** Unique identifier for this subagent invocation */
  agentId?: string;
  /** The tool_use_id that spawned this subagent (correlates with parent agent) */
  parentToolUseId?: string;
  /** The prompt/task given to the subagent */
  prompt?: string;
  /** Result from the subagent (when phase is "completed") */
  result?: string;
  /** Error message (when phase is "failed") */
  error?: string;
  /** Timestamp */
  ts?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Background/foreground task lifecycle event.
 *
 * The Claude CLI runs long tool calls as *tasks* — a Bash command that outlives
 * the foreground timeout is backgrounded, and every Agent (subagent) call is a
 * task too. The spawning tool call returns immediately ("Command running in
 * background with ID: …"), so without these events the run ends before the task
 * does and its real result is never surfaced.
 *
 * `toolCallId` is the correlation key: it is the tool_use_id of the tool call
 * that spawned the task, which is how consumers attach this to an existing tool
 * call row. The SDK's `task_updated` message carries only `taskId`, so drivers
 * are expected to resolve it back to a tool_use_id themselves.
 */
export interface WorkRunTaskEvent {
  type: "task";
  /** Lifecycle phase, mapped from the SDK's `system:task_*` subtypes. */
  phase: "started" | "progress" | "updated" | "completed";
  /** Provider task id, stable for the task's lifetime. */
  taskId: string;
  /** tool_use_id of the spawning tool call — the correlation key. */
  toolCallId?: string;
  /** Terminal status (phase "completed") or patched status (phase "updated"). */
  status?:
    | "completed"
    | "failed"
    | "stopped"
    | "pending"
    | "running"
    | "killed"
    | "paused";
  /** Human-readable task description (e.g. the backgrounded command). */
  description?: string;
  /** Subagent type when the task is an Agent tool invocation. */
  subagentType?: string;
  /** Task kind reported by the provider, e.g. "local_bash", "local_workflow". */
  taskType?: string;
  /** Progress or completion summary. */
  summary?: string;
  /** Path to the task's captured output — where a backgrounded command's real output lands. */
  outputFile?: string;
  /** Most recent tool the task ran (progress phase). */
  lastToolName?: string;
  /** Token/tool/duration totals reported for the task. */
  usage?: { totalTokens?: number; toolUses?: number; durationMs?: number };
  /** Error detail when the task failed. */
  error?: string;
  /** Ambient/housekeeping task — consumers should hide it from the inline transcript. */
  skipTranscript?: boolean;
  /** Timestamp */
  ts?: number;
}

/**
 * Prompt suggestion event emitted after a turn completes
 */
export interface WorkRunPromptSuggestionEvent {
  type: "prompt_suggestion";
  suggestion: string;
  ts?: number;
}

/**
 * Context-window usage snapshot, emitted at turn boundaries. Renderer-only
 * (ephemeral): used to drive a live context-fill indicator. Not persisted.
 */
export interface WorkRunContextUsageEvent {
  type: "context_usage";
  /** Tokens currently occupying the context window. */
  totalTokens: number;
  /** Effective context window size for the active model. */
  maxTokens: number;
  /** 0–100 fill percentage (as reported by the SDK). */
  percentage: number;
  /** Model the snapshot was computed for. */
  model?: string;
  /** Whether auto-compaction is enabled for the session. */
  isAutoCompactEnabled?: boolean;
  /** Token count at which auto-compaction triggers, when known. */
  autoCompactThreshold?: number;
  /**
   * Per-category breakdown of the window, as the provider partitions it.
   *
   * `used` rows are the occupied portion, `free` is what remains, `buffer` is
   * the compaction reserve, and `deferred` rows sit outside the window
   * (out-of-context tool schemas) and are excluded from the usage math.
   *
   * Semantic only — the renderer owns presentation. Providers must not send
   * colors or class names.
   */
  categories?: WorkRunContextUsageCategory[];
  ts?: number;
}

export interface WorkRunContextUsageCategory {
  name: string;
  tokens: number;
  kind: "used" | "free" | "buffer" | "deferred";
}

export interface WorkRunPlanStep {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * Latest structured execution-plan snapshot for the active provider turn.
 *
 * This is intentionally separate from a provider's user-facing plan proposal
 * item: it represents live execution progress, not content awaiting approval.
 */
export interface WorkRunPlanUpdateEvent {
  type: "plan_update";
  providerTurnId: string;
  explanation?: string;
  steps: WorkRunPlanStep[];
  ts?: number;
}

/**
 * Union of all possible events emitted during a work run
 */
export type WorkRunEvent =
  | WorkRunLogEvent
  | WorkRunToolCallEvent
  | WorkRunArtifactEvent
  | WorkRunStatusEvent
  | WorkRunSubagentEvent
  | WorkRunTaskEvent
  | WorkRunPromptSuggestionEvent
  | WorkRunContextUsageEvent
  | WorkRunPlanUpdateEvent;

/**
 * Artifact summary in the result
 */
export interface WorkRunArtifactSummary {
  id?: number;
  kind: string;
  path?: string;
}

/**
 * Stop reason indicating why the model stopped generating.
 * Maps to Claude Agent SDK's ResultMessage.stop_reason field.
 */
export type StopReason = string | null;

/**
 * Per-model token/cost breakdown from SDK modelUsage
 */
export interface ModelUsageEntry {
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * Usage data captured from a completed work run
 */
export interface WorkRunUsage {
  totalCostUsd?: number;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
  modelUsage?: Record<string, ModelUsageEntry>;
}

/**
 * Result returned when a work run completes
 */
export interface WorkRunResult {
  status: "succeeded" | "failed" | "canceled";
  summary?: string;
  stopReason?: StopReason;
  artifacts?: WorkRunArtifactSummary[];
  usage?: WorkRunUsage;
}

/**
 * Callback for receiving events during a work run
 */
export type WorkRunEventHandler = (event: WorkRunEvent) => void | Promise<void>;

/**
 * Request to continue an existing run (resume session)
 */
export interface WorkRunContinueRequest {
  runId: string;
  accountId: string;
  execution: RunExecutionContext;
  /** The follow-up message/goal */
  message: string;
  /** Model to use for this continuation (overrides provider default) */
  model?: string | null;
  /** The run's original system prompt, re-applied by drivers that rebuild
   * their session config on resume (copilot). */
  systemPrompt?: string | null;
  /** Experience mode snapshot from the run row (see `src/shared/modes.ts`). */
  mode?: ModeId;
  /** Mode-resolved instruction delta, re-applied on resume (new threads inherit it). */
  extraInstructions?: string | null;
  /** Per-run tool policy, re-derived from the run row (see WorkRunRequest). */
  toolPolicy?: WorkRunToolPolicy | null;
  /** Per-run config snapshot, re-derived from the run row (see WorkRunRequest). */
  configSnapshot?: Record<string, unknown> | null;
  /** Additional context to add */
  context?: WorkRunContextItem[];
  /** File attachments (images/documents) to include in the prompt */
  attachments?: FileAttachment[];
  /** Structured context issues to inject into this follow-up */
  contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
  /** Structured context signals (error reports) to inject into this follow-up */
  contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
  /** Structured context files to inject into this follow-up */
  contextFiles?: Array<{ path: string }>;
  /** User-selected skills to invoke for this follow-up (adapter decides how to inject) */
  skills?: Array<{
    name: string;
    path?: string;
    displayName?: string;
    description?: string;
    shortDescription?: string;
    iconSmall?: string;
    iconLarge?: string;
    brandColor?: string;
    scope?: string;
  }>;
  /**
   * Per-run hooks configuration for this continuation.
   * Useful for dynamic hook configuration based on the continuation context.
   */
  hooks?: HooksConfig;
  /**
   * Per-run subagents configuration for this continuation.
   * Allows adding or overriding subagents for specific continuation tasks.
   */
  agents?: AgentsConfig;
}

/**
 * Request to fork an existing run's session into a new run.
 * Creates a new session branched from the source run's session state.
 */
export interface WorkRunForkRequest {
  /** The new run ID for the forked session */
  runId: string;
  /** The source run whose session will be forked */
  sourceRunId: string;
  accountId: string;
  execution: RunExecutionContext;
  /** The message/goal for the forked session */
  message: string;
  /** Model to use for this fork (overrides provider default) */
  model?: string | null;
  /** Experience mode inherited from the source run (see `src/shared/modes.ts`). */
  mode?: ModeId;
  /** Mode-resolved instruction delta, re-applied on the forked session. */
  extraInstructions?: string | null;
  /** Per-run tool policy inherited from the source run (see WorkRunRequest). */
  toolPolicy?: WorkRunToolPolicy | null;
  /** Per-run config snapshot inherited from the source run (see WorkRunRequest). */
  configSnapshot?: Record<string, unknown> | null;
  /** Additional context to add */
  context?: WorkRunContextItem[];
  /** File attachments (images/documents) to include in the prompt */
  attachments?: FileAttachment[];
  /** Per-run hooks configuration */
  hooks?: HooksConfig;
  /** Per-run subagents configuration */
  agents?: AgentsConfig;
}

/**
 * Target scope for a native code review
 */
export interface WorkRunReviewTarget {
  type: "uncommittedChanges" | "baseBranch" | "commit" | "custom";
  /** Branch name for baseBranch target */
  branch?: string;
  /** Commit SHA for commit target */
  sha?: string;
  /** Commit title for commit target */
  title?: string;
  /** Free-form instructions for custom target */
  instructions?: string;
}

/**
 * Request to start a native code review run
 */
export interface WorkRunReviewRequest {
  runId: string;
  accountId: string;
  execution: RunExecutionContext;
  target: WorkRunReviewTarget;
  /** inline = review on same thread (default), detached = fork new review thread */
  delivery?: "inline" | "detached";
  model?: string | null;
}

/**
 * Interface that all work run adapters must implement
 */
export interface WorkRunAdapter {
  /**
   * Start a work run with the given request.
   * Events are emitted via the onEvent callback during execution.
   * @param request - The run configuration
   * @param onEvent - Callback invoked for each event during the run
   * @returns Promise resolving to the final result when the run completes
   */
  startRun(request: WorkRunRequest, onEvent: WorkRunEventHandler): Promise<WorkRunResult>;

  /**
   * Continue an existing run by resuming its session and sending a follow-up message.
   * @param request - The continue request with runId and new message
   * @param onEvent - Callback invoked for each event during the run
   * @returns Promise resolving to the final result when the continuation completes
   */
  continueRun?(request: WorkRunContinueRequest, onEvent: WorkRunEventHandler): Promise<WorkRunResult>;

  /**
   * Fork an existing run's session into a new run.
   * Creates a new session branched from the source run's session state,
   * leaving the original session unchanged.
   * @param request - The fork request with sourceRunId, new runId, and message
   * @param onEvent - Callback invoked for each event during the run
   * @returns Promise resolving to the final result when the forked run completes
   */
  forkRun?(request: WorkRunForkRequest, onEvent: WorkRunEventHandler): Promise<WorkRunResult>;

  /**
   * Start a native code review run using the provider's built-in review mode.
   * Falls back to startRun with a review goal if not implemented.
   * @param request - The review configuration with target scope
   * @param onEvent - Callback invoked for each event during the review
   * @returns Promise resolving to the final result when the review completes
   */
  reviewRun?(request: WorkRunReviewRequest, onEvent: WorkRunEventHandler): Promise<WorkRunResult>;

  /**
   * Abort a currently running work run.
   * @param runId - The ID of the run to abort
   */
  abortRun?(runId: string): Promise<void>;

  /**
   * Check if a session exists and can be resumed.
   * @param runId - The session/run ID to check
   * @returns Promise resolving to true if session can be resumed
   */
  canResumeSession?(runId: string): Promise<boolean>;

  /** Archive a persisted provider session without deleting its history. */
  archiveSession?(runId: string): Promise<void>;

  /** Restore a previously archived provider session. */
  unarchiveSession?(runId: string): Promise<void>;

  /**
   * Delete a persisted session permanently.
   * @param runId - The session/run ID to delete
   */
  deleteSession?(runId: string): Promise<void>;

  /**
   * Gracefully shutdown the adapter, cleaning up resources.
   */
  shutdown?(): Promise<void>;

  /**
   * Push a newer `providers.config` into the cached adapter instance.
   * See {@link ProviderDriver.updateConfig} — this is the factory's alternative
   * to dropping and rebuilding the adapter on every settings write.
   */
  updateConfig?(config: AdapterConfig): void;

  /**
   * List available models with their metadata.
   * @returns Promise resolving to array of ModelInfo
   * @throws Error if not authenticated or client not connected
   */
  listModels?(): Promise<ModelInfo[]>;

  /**
   * List available slash commands.
   * @returns Promise resolving to array of CommandInfo
   */
  /** Workspace path lets Claude exclude project disk skills from the / menu (same dirs as listSkills). */
  listCommands?(workspacePath?: string): Promise<CommandInfo[]>;

  /**
   * List available skills.
   * Skills are SKILL.md files that extend Claude's capabilities.
   * @param workspacePath - Optional workspace path for discovering project skills
   * @returns Promise resolving to array of SkillInfo
   */
  listSkills?(workspacePath?: string): Promise<SkillInfo[]>;

  /**
   * Generate a short title for a run based on its goal and context.
   * Used to produce a human-readable tab title instead of truncated goal text.
   * @param goal - The user's goal/prompt for the run
   * @param context - Optional context items provided to the run
   * @returns Promise resolving to a short title string (3-6 words)
   */
  generateTitle?(goal: string, context?: WorkRunContextItem[]): Promise<string>;

  /**
   * Generate freeform text from a one-shot, headless prompt (single turn, no
   * tools). Used for deterministic flows that need a model-written string —
   * e.g. a commit message or PR body — without spinning up an interactive run.
   * @param prompt - The user prompt to complete.
   * @param opts - Optional system instruction and model override.
   * @returns Promise resolving to the trimmed assistant text.
   */
  generateText?(
    prompt: string,
    opts?: { system?: string; model?: string },
  ): Promise<string>;

  /**
   * Get current rate limit information from the provider.
   * @returns Promise resolving to rate limit data, or null if not supported
   */
  getRateLimits?(): Promise<RateLimitInfo | null>;

  // ── Thread goal controls (Codex `thread/goal/*`) ──
  /** Set/update the goal for a run's thread. Partial — omitted fields unchanged. */
  setGoal?(runId: string, params: GoalSetParams): Promise<GoalInfo | null>;
  /** Read the current goal for a run's thread (null if none). */
  getGoal?(runId: string): Promise<GoalInfo | null>;
  /** Clear the goal on a run's thread. Returns true if cleared. */
  clearGoal?(runId: string): Promise<boolean>;

  /**
   * Read account info from the provider.
   */
  getAccountInfo?(): Promise<AccountInfo>;

  /**
   * Update the provider's CLI to the latest version (e.g. `agent update`).
   * @returns success flag plus captured stdout/stderr for display.
   */
  updateCli?(): Promise<CliUpdateResult>;

  /**
   * List available plugins from the provider's marketplace.
   * @returns Promise resolving to plugin marketplace data
   */
  listPlugins?(): Promise<PluginListResponse>;

  /**
   * List installed plugins without loading the full remote marketplace.
   * Providers without a dedicated installed-only surface may fall back to
   * filtering listPlugins() in the adapter factory.
   */
  listInstalledPlugins?(): Promise<PluginListResponse>;

  /**
   * Read detailed plugin info including skills, apps, and MCP servers.
   */
  readPlugin?(pluginName: string, marketplacePath: string): Promise<PluginDetail>;

  /**
   * Install a plugin by ID.
   * @param pluginId - The plugin ID to install
   * @param scope - Installation scope (user/project/local). Defaults to "user".
   */
  installPlugin?(pluginId: string, scope?: PluginScope): Promise<void>;

  /**
   * Uninstall a plugin by ID.
   * @param pluginId - The plugin ID to uninstall
   */
  uninstallPlugin?(pluginId: string): Promise<void>;

  /**
   * Enable or disable an installed plugin without uninstalling it.
   */
  setPluginEnabled?(pluginId: string, enabled: boolean): Promise<void>;

  /**
   * Update an installed plugin to the latest version.
   */
  updatePlugin?(pluginId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// ProviderDriver — the SDK-specific seam behind WorkRunCore
//
// Each provider (cursor, copilot, claude, codex) ships a `ProviderDriver`
// that knows its SDK's API. `createWorkRunAdapter(driver)` wraps it in the
// shared lifecycle (status emission, artifact collection, AbortSignal
// propagation, sessionId persistence, cleanup) and returns a WorkRunAdapter.
//
// The Driver owns:
//   - Acquiring sessions (new / resume / fork / review) and building the
//     prompt that goes with them.
//   - Mapping the SDK's streaming messages into WorkRunEvents and pushing
//     them via onEvent.
//   - Reporting the final outcome (status + stopReason + usage).
//
// Core owns:
//   - The `runId → session` map for abort lookup.
//   - Wrapping onEvent to collect artifacts and inject timestamps.
//   - Persisting sessionId to runsRepo when acquisition reports it.
//   - Emitting `running` / final status events around the Driver's work.
//   - Per-run cleanup (driver.cleanup, cancelPendingRequests).
// ─────────────────────────────────────────────────────────────

/** Outcome the Driver returns from executePrompt. */
export interface DriverOutcome {
  status: "succeeded" | "failed" | "canceled";
  stopReason?: string;
  usage?: WorkRunUsage;
  /** Error message when status is "failed" or "canceled" with a reason. */
  summary?: string;
}

/**
 * Result of a session-acquisition method. Driver returns the opaque session
 * (Core stores it for abort lookup), the prompt to send, and optionally the
 * sessionId so Core can persist it to runsRepo.
 */
export interface AcquiredSession {
  /** Driver-opaque session handle. Core stores and forwards on abort/cleanup. */
  session: unknown;
  /** The full prompt string to send to the SDK. */
  prompt: string;
  /** Provider-assigned session ID; Core persists to runsRepo when present. */
  sessionId?: string;
}

export interface ProviderDriver {
  /** Create a new session and build the initial prompt. */
  createSession(request: WorkRunRequest): Promise<AcquiredSession>;

  /** Resume an existing session by id and build the follow-up prompt. */
  resumeSession?(request: WorkRunContinueRequest): Promise<AcquiredSession>;

  /** Fork an existing session into a new run and build the prompt. */
  forkSession?(request: WorkRunForkRequest): Promise<AcquiredSession>;

  /** Acquire a session for a native code review. */
  reviewSession?(request: WorkRunReviewRequest): Promise<AcquiredSession>;

  /**
   * Run the prompt against the session, pushing WorkRunEvents to onEvent as
   * the SDK streams. Honour `signal` — Core fires it on abortRun.
   * Resolve with the final outcome.
   */
  executePrompt(
    session: unknown,
    prompt: string,
    onEvent: WorkRunEventHandler,
    signal: AbortSignal,
  ): Promise<DriverOutcome>;

  /** Tear down per-run state in the SDK (file handles, timers, etc.). */
  cleanup?(session: unknown): Promise<void>;

  /**
   * Adopt a newer `providers.config` in place, so the *same* driver instance
   * keeps serving after a settings write. Drivers that own a long-lived
   * process (Codex's app-server, Cursor's ACP server) MUST implement this:
   * rebuilding the driver instead would spawn a second process while the first
   * still holds its sessions — Codex answers `thread/resume` on a thread the
   * previous process still owns with "already has an active writer".
   * Implementations mutate their captured config object rather than swapping
   * the reference, since collaborators (session acquisition, capabilities)
   * hold that same object.
   */
  updateConfig?(config: AdapterConfig): void;

  // ── Pass-through methods (Core delegates 1:1 to the matching WorkRunAdapter method) ──
  shutdown?(): Promise<void>;
  canResumeSession?(runId: string): Promise<boolean>;
  archiveSession?(runId: string): Promise<void>;
  unarchiveSession?(runId: string): Promise<void>;
  deleteSession?(runId: string): Promise<void>;
  listModels?(): Promise<ModelInfo[]>;
  listCommands?(workspacePath?: string): Promise<CommandInfo[]>;
  listSkills?(workspacePath?: string): Promise<SkillInfo[]>;
  generateTitle?(goal: string, context?: WorkRunContextItem[]): Promise<string>;
  generateText?(
    prompt: string,
    opts?: { system?: string; model?: string },
  ): Promise<string>;
  getRateLimits?(): Promise<RateLimitInfo | null>;
  getAccountInfo?(): Promise<AccountInfo>;
  updateCli?(): Promise<CliUpdateResult>;
  listPlugins?(): Promise<PluginListResponse>;
  listInstalledPlugins?(): Promise<PluginListResponse>;
  readPlugin?(pluginName: string, marketplacePath: string): Promise<PluginDetail>;
  installPlugin?(pluginId: string, scope?: PluginScope): Promise<void>;
  uninstallPlugin?(pluginId: string): Promise<void>;
  setPluginEnabled?(pluginId: string, enabled: boolean): Promise<void>;
  updatePlugin?(pluginId: string): Promise<void>;

  // ── Thread goal controls (Codex `thread/goal/*`) ──
  /** Set/update the goal for a run's thread. Partial — omitted fields unchanged. */
  setGoal?(runId: string, params: GoalSetParams): Promise<GoalInfo | null>;
  /** Read the current goal for a run's thread (null if none). */
  getGoal?(runId: string): Promise<GoalInfo | null>;
  /** Clear the goal on a run's thread. Returns true if cleared. */
  clearGoal?(runId: string): Promise<boolean>;
}

/**
 * A thread goal as tracked by Codex (`thread/goal/*`). Tracks progress
 * (token/time usage) against an objective for the lifetime of a thread.
 */
export interface GoalInfo {
  threadId: string;
  objective: string;
  /** active | blocked | budgetLimited | usageLimited */
  status: string;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  createdAt?: number;
  updatedAt?: number;
}

/** Params for {@link ProviderDriver.setGoal}. All fields optional (partial update). */
export interface GoalSetParams {
  objective?: string;
  status?: string;
  tokenBudget?: number;
}

/**
 * Rate limit information from a provider
 */
export interface SpendControlLimitInfo {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: number;
}

export interface RateLimitSnapshotInfo {
  limitId?: string;
  limitName?: string;
  planType?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  credits?: { hasCredits: boolean; balance?: string; unlimited: boolean };
  individualLimit?: SpendControlLimitInfo;
  spendControlReached?: boolean;
  rateLimitReachedType?: string;
}

export interface RateLimitResetCreditInfo {
  id: string;
  resetType: string;
  status: string;
  grantedAt: number;
  expiresAt?: number;
  title?: string;
  description?: string;
}

export interface RateLimitInfo extends RateLimitSnapshotInfo {
  /** Complete multi-bucket view keyed by Codex's metered limit id. */
  rateLimitsByLimitId?: Record<string, RateLimitSnapshotInfo>;
  rateLimitResetCredits?: {
    availableCount: number;
    /** Undefined means the backend only returned a count. */
    credits?: RateLimitResetCreditInfo[];
  };
}

export interface RateLimitWindow {
  /** Percentage used (0-100) */
  usedPercent: number;
  /** Window duration in minutes */
  windowDurationMins?: number;
  /** Unix timestamp when the window resets */
  resetsAt?: number;
  /** Optional human label for the window (e.g. Copilot quota type "Premium requests"). */
  label?: string;
  /** Optional raw counts (e.g. Copilot requests used / entitlement). */
  used?: number;
  total?: number;
}

/**
 * Configuration for OpenAI Codex adapter
 */
export interface CodexAdapterConfig {
  /** Path to codex CLI binary (defaults to "codex" from PATH) */
  binary?: string;
  /** Optional API key. If omitted, the Codex CLI uses cached auth from ~/.codex/auth.json (via `codex` login or `codex login --device-auth`), or OPENAI_API_KEY / CODEX_API_KEY env vars */
  apiKey?: string;
  /** Default model to use (e.g., "gpt-5.4", "gpt-5.4-mini") */
  defaultModel?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Approval policy passed to Codex CLI (no interactive hooks — CLI handles internally) */
  approvalMode?: "untrusted" | "on-request" | "never";
  /** Sandbox mode for file/network isolation */
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  /** Model reasoning effort level */
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /**
   * Service tier id passed to `turn/start` (e.g. "priority", "flex", "default").
   * Discovered via `model/list` per-model `serviceTiers`. When set on the adapter
   * config it applies to all turns; per-run config snapshot can override.
   */
  serviceTier?: string;
  /** Enable network access within sandbox_workspace_write mode */
  networkAccessEnabled?: boolean;
  /** Web search mode */
  webSearchMode?: "disabled" | "cached" | "live";
  /** Skip git repo check for non-git directories */
  skipGitRepoCheck?: boolean;
  /** Thread personality — controls the agent's conversational style */
  personality?: "friendly" | "pragmatic" | "none";
  /**
   * When true, sends `collaborationMode: { mode: "plan", … }` on `turn/start`,
   * activating Codex's built-in plan preset (medium reasoning, plan instructions).
   * Independent of `sandboxMode` — both can be active.
   */
  planMode?: boolean;
  /**
   * When true, the run's prompt is registered as the thread's goal via
   * `thread/goal/set` (objective = prompt) right after `thread/start`. Codex
   * then tracks token/time usage against the goal and reports "Goal achieved".
   * Per-run config snapshot can override.
   */
  goalMode?: boolean;
  /** Additional directories the agent can access */
  additionalDirectories?: string[];
  /** Base URL override for OpenAI API */
  baseUrl?: string;
  /** Additional Codex CLI config overrides (passed as --config key=value) */
  config?: Record<string, unknown>;
  /** Saved JSON Schema definitions for structured output (forwarded as `outputSchema` on `turn/start`). */
  structuredOutputs?: Record<string, StructuredOutputEntry>;
  /** ID of the currently selected structured output schema (null = disabled). */
  structuredOutputsSelectedId?: string | null;
}

/**
 * Configuration for Copilot adapter stored in providers.config
 */
export interface CopilotAdapterConfig {
  /** Path to copilot CLI binary (defaults to "copilot" from PATH) */
  binary?: string;
  /** Transport method: "stdio" (default) or "tcp" */
  useStdio?: boolean;
  /** TCP port if transport is "tcp" */
  port?: number;
  /** URL of existing CLI server to connect to */
  cliUrl?: string;
  /** Log level for the SDK */
  logLevel?: "debug" | "info" | "warning" | "error" | "none" | "all";
  /** Default model to use */
  defaultModel?: string;
  /** Timeout in milliseconds for operations */
  timeout?: number;
  /** Whether to start the CLI process automatically */
  autoStart?: boolean;
  /** GitHub token for authentication — takes priority over other auth methods */
  githubToken?: string;
  /** Whether to use stored OAuth tokens or gh CLI auth (default: true) */
  useLoggedInUser?: boolean;
  /** Permission mode for tool access */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

/**
 * Configuration for Claude Code adapter
 */
export interface ClaudeCodeAdapterConfig {
  /** Path to claude CLI binary */
  binary?: string;
  /** API key (if not using CLI auth) */
  apiKey?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Permission mode for tool access */
  permissionMode?: ClaudePermissionMode;
  /**
   * Setting sources for loading skills and other filesystem settings.
   * - "user": Load from ~/.claude/skills/
   * - "project": Load from .claude/skills/ in the working directory
   */
  settingSources?: Array<"user" | "project">;
  /**
   * Hooks configuration for intercepting agent behavior.
   * Hooks let you validate, log, block, or transform agent actions at key execution points.
   *
   * @example
   * ```ts
   * hooks: {
   *   PreToolUse: [{
   *     matcher: 'Write|Edit',
   *     hooks: [async (input, toolUseId, { signal }) => {
   *       if (input.tool_input?.file_path?.endsWith('.env')) {
   *         return {
   *           hookSpecificOutput: {
   *             hookEventName: 'PreToolUse',
   *             permissionDecision: 'deny',
   *             permissionDecisionReason: 'Cannot modify .env files'
   *           }
   *         };
   *       }
   *       return {};
   *     }]
   *   }],
   *   PostToolUse: [{
   *     hooks: [async (input) => {
   *       console.log(`Tool ${input.tool_name} completed`);
   *       return {};
   *     }]
   *   }]
   * }
   * ```
   */
  hooks?: HooksConfig;
  /**
   * Subagents configuration for delegating specialized tasks.
   * Subagents maintain separate context and can have restricted tool access.
   *
   * @example
   * ```ts
   * agents: {
   *   'code-reviewer': {
   *     description: 'Expert code reviewer for quality and security reviews.',
   *     prompt: 'You are a code review specialist...',
   *     tools: ['Read', 'Grep', 'Glob'],
   *     model: 'sonnet'
   *   },
   *   'test-runner': {
   *     description: 'Runs and analyzes test suites.',
   *     prompt: 'You are a test execution specialist...',
   *     tools: ['Bash', 'Read', 'Grep']
   *   }
   * }
   * ```
   */
  agents?: AgentsConfig;
  /** Saved JSON Schema definitions for structured output */
  structuredOutputs?: Record<string, StructuredOutputEntry>;
  /** ID of the currently selected structured output schema (null = disabled) */
  structuredOutputsSelectedId?: string | null;
  /** When true, enables adaptive thinking (extended reasoning) */
  thinkingMode?: boolean;
  /**
   * Fixed thinking-token budget (requires thinkingMode). When set, the adapter
   * uses `thinking: { type: "enabled", budgetTokens }` instead of adaptive
   * thinking. Useful on models without adaptive support, or to cap cost/latency.
   */
  thinkingBudgetTokens?: number;
  /** When true, enables fast mode (faster output, same model) */
  fastMode?: boolean;
  /** Effort level for thinking depth (requires thinkingMode) */
  effortLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * When true, enables ultracode: xhigh effort plus automatic dynamic-workflow
   * orchestration. Forwarded to the SDK via `settings.ultracode` (not `effort`).
   * Only meaningful on a model whose supportedEffortLevels includes "xhigh".
   */
  ultracode?: boolean;
  /**
   * Local plugins to load for each run. Each plugin directory can contribute
   * commands, agents, skills, hooks, and (unless skipMcpDiscovery) MCP servers.
   * Forwarded to the SDK as `options.plugins` ({ type: "local", path }).
   */
  plugins?: Array<{ path: string; skipMcpDiscovery?: boolean }>;
}

/**
 * Configuration for Cursor adapter (ACP protocol)
 */
export interface CursorAdapterConfig {
  /** Path to cursor CLI binary (defaults to "cursor" from PATH) */
  binary?: string;
  /** Optional API key. If omitted, uses cached auth from `cursor login` or CURSOR_API_KEY env var */
  apiKey?: string;
  /** Default model to use (e.g., "gpt-5.2", "claude-4-sonnet-thinking") */
  defaultModel?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Agent mode: "agent" (default), "plan", or "ask" */
  mode?: "agent" | "plan" | "ask";
  /**
   * Default reasoning effort, applied via the ACP parameterized model picker
   * (`session/set_config_option`). Only honored by models that advertise a
   * reasoning/effort option. Overridable per-run via `configSnapshot.effortLevel`.
   */
  effortLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Enable fast mode via the parameterized model picker (model must advertise it). */
  fastMode?: boolean;
  /** Enable adaptive thinking via the parameterized model picker (model must advertise it). */
  thinking?: boolean;
}

/**
 * Any provider's adapter config, as stored in `providers.config`.
 * The factory narrows it per provider id; drivers cast to their own shape.
 */
export type AdapterConfig =
  | CodexAdapterConfig
  | CopilotAdapterConfig
  | ClaudeCodeAdapterConfig
  | CursorAdapterConfig;

/**
 * A persisted JSON Schema entry for structured output
 */
export interface StructuredOutputEntry {
  id: string;
  name: string;
  schema: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Model information returned by adapters
 */
export interface ModelInfo {
  /** Model identifier (e.g., "gpt-4o", "claude-3-5-sonnet") */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Model version or variant */
  version?: string;
  /** Whether this is the default model for the provider */
  isDefault?: boolean;
  /** Model capabilities */
  capabilities?: {
    streaming?: boolean;
    vision?: boolean;
    functionCalling?: boolean;
    reasoning?: boolean;
  };
  /** Context window size in tokens */
  contextWindow?: number;
  /** Whether this model supports fast mode */
  supportsFastMode?: boolean;
  /** Whether this model supports effort levels */
  supportsEffort?: boolean;
  /** Available effort levels for this model */
  supportedEffortLevels?: ('minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh')[];
  /**
   * Provider-specific service tiers (e.g. Codex: `priority`, `flex`, `default`).
   * When set, the UI exposes a tier picker so users can trade quality/cost
   * vs. throughput per turn. The tier is passed to the provider on `turn/start`.
   */
  serviceTiers?: Array<{ id: string; name: string; description?: string }>;
  /** Model description */
  description?: string;
  // TODO: expose in UI — model supports auto mode selection
  supportsAutoMode?: boolean;
  // TODO: expose in UI — model supports adaptive thinking (Claude decides when to think)
  supportsAdaptiveThinking?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Command/slash command information returned by adapters
 */
export interface CommandInfo {
  /** Command name (e.g., "help", "clear", "compact") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Hint for command arguments */
  argumentHint?: string;
  /** Whether the command is user-invokable */
  userFacing?: boolean;
}

/**
 * Skill information returned by adapters
 * Skills are Claude Agent SDK capabilities defined as SKILL.md files
 */
export interface SkillInfo {
  /** Skill name (e.g., "explain-code", "deploy") */
  name: string;
  /** Human-readable description of what the skill does */
  description?: string;
  /** Hint for skill arguments (from argument-hint frontmatter) */
  argumentHint?: string;
  /** Whether the skill is user-invokable (can be triggered with /name). Default: true */
  userInvokable?: boolean;
  /** Whether Claude can automatically invoke this skill. Default: true (false if disable-model-invocation is set) */
  modelInvocable?: boolean;
  /** Source location: "user" (~/.claude/skills/) or "project" (.claude/skills/) */
  source?: "user" | "project";
  /** Model to use when skill is active */
  model?: string;
  /** Whether skill runs in forked subagent context (context: fork) */
  forked?: boolean;
  /** Agent type for forked context */
  agent?: string;
  /** Full path to the SKILL.md file */
  path?: string;
  /** Human-friendly display name (from interface.displayName, e.g. "Documents") */
  displayName?: string;
  /** Short description for compact UI surfaces (from interface.shortDescription) */
  shortDescription?: string;
  /** Small icon path/url (from interface.iconSmall) */
  iconSmall?: string;
  /** Large icon path/url (from interface.iconLarge) */
  iconLarge?: string;
  /** Brand color (hex string, from interface.brandColor) */
  brandColor?: string;
  /** Default prompt suggestion (from interface.defaultPrompt) */
  defaultPrompt?: string;
  /** Provider-reported scope: "user" | "project" | "system" | other */
  scope?: "user" | "project" | "system" | string;
  /** Whether the skill is enabled */
  enabled?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Claude Agent SDK Subagents Types
// ─────────────────────────────────────────────────────────────

/**
 * Model options for subagents
 * - "sonnet": Use Claude Sonnet model
 * - "opus": Use Claude Opus model (most capable)
 * - "haiku": Use Claude Haiku model (fastest)
 * - "inherit": Use the same model as the parent agent
 */
export type AgentModelOption = "sonnet" | "opus" | "haiku" | "inherit";

/**
 * Definition for a subagent that can be spawned by the main agent.
 * Subagents maintain separate context and can have specialized instructions and tool restrictions.
 *
 * @example
 * ```ts
 * const codeReviewer: AgentDefinition = {
 *   description: 'Expert code reviewer for quality and security reviews.',
 *   prompt: `You are a code review specialist with expertise in security and best practices.
 *
 * When reviewing code:
 * - Identify security vulnerabilities
 * - Check for performance issues
 * - Suggest specific improvements`,
 *   tools: ['Read', 'Grep', 'Glob'],
 *   model: 'sonnet'
 * };
 * ```
 */
export interface AgentDefinition {
  /**
   * Natural language description of when to use this agent.
   * Claude uses this to decide whether to delegate tasks to this subagent.
   * Write clear descriptions that explain the agent's specialty.
   *
   * @example "Expert code reviewer for quality and security reviews"
   * @example "Test execution specialist for running and analyzing test suites"
   */
  description: string;

  /**
   * The agent's system prompt defining its role, behavior, and expertise.
   * This is the instruction set the subagent follows when executing tasks.
   *
   * @example
   * ```
   * You are a code review specialist with expertise in security, performance, and best practices.
   *
   * When reviewing code:
   * - Identify security vulnerabilities
   * - Check for performance issues
   * - Verify adherence to coding standards
   * - Suggest specific improvements
   *
   * Be thorough but concise in your feedback.
   * ```
   */
  prompt: string;

  /**
   * Array of tool names the subagent is allowed to use.
   * If omitted, the agent inherits all tools from the parent.
   *
   * Common tool combinations:
   * - Read-only analysis: ['Read', 'Grep', 'Glob']
   * - Test execution: ['Bash', 'Read', 'Grep']
   * - Code modification: ['Read', 'Edit', 'Write', 'Grep', 'Glob']
   *
   * Note: Do NOT include 'Task' in a subagent's tools - subagents cannot spawn their own subagents.
   */
  tools?: string[];

  /** Array of tool names to explicitly disallow for this agent */
  disallowedTools?: string[];

  /**
   * Model to use for this subagent.
   * If omitted, uses the same model as the parent agent.
   */
  model?: AgentModelOption;

  /** MCP server configurations specific to this subagent */
  mcpServers?: (string | Record<string, unknown>)[];

  /** Array of skill names to preload into the agent context */
  skills?: string[];

  /** Auto-submitted as the first user turn when this agent starts. Slash commands are processed. */
  initialPrompt?: string;

  /** Maximum number of agentic turns (API round-trips) before stopping */
  maxTurns?: number;

  /** Experimental: Critical reminder added to system prompt */
  criticalSystemReminder_EXPERIMENTAL?: string;
}

/**
 * Configuration object mapping agent names to their definitions.
 * Agent names should be kebab-case identifiers.
 *
 * @example
 * ```ts
 * const agents: AgentsConfig = {
 *   'code-reviewer': {
 *     description: 'Expert code reviewer',
 *     prompt: 'You are a code review specialist...',
 *     tools: ['Read', 'Grep', 'Glob']
 *   },
 *   'test-runner': {
 *     description: 'Test execution specialist',
 *     prompt: 'You are a test execution specialist...',
 *     tools: ['Bash', 'Read', 'Grep']
 *   }
 * };
 * ```
 */
export type AgentsConfig = Record<string, AgentDefinition>;

// ─────────────────────────────────────────────────────────────
// Claude Agent SDK Hooks Types
// ─────────────────────────────────────────────────────────────

/**
 * Hook event names supported by the Claude Agent SDK
 * TODO:
 */
export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "Stop"
  | "StopFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PostCompact"
  | "PermissionRequest"
  | "SessionStart"
  | "SessionEnd"
  | "Notification"
  | "Setup"
  | "TeammateIdle"
  | "TaskCreated"
  | "TaskCompleted"
  | "Elicitation"
  | "ElicitationResult"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "InstructionsLoaded"
  | "CwdChanged"
  | "FileChanged";

/**
 * Base input fields common to all hook callbacks
 */
export interface HookInputBase {
  /** The hook event type that triggered this callback */
  hook_event_name: HookEventName;
  /** Current session identifier */
  session_id: string;
  /** Path to the conversation transcript */
  transcript_path: string;
  /** Current working directory */
  cwd: string;
}

/**
 * Input data for PreToolUse hook
 */
export interface PreToolUseHookInput extends HookInputBase {
  hook_event_name: "PreToolUse";
  /** Name of the tool being called */
  tool_name: string;
  /** Arguments passed to the tool */
  tool_input: Record<string, unknown>;
}

/**
 * Input data for PostToolUse hook
 */
export interface PostToolUseHookInput extends HookInputBase {
  hook_event_name: "PostToolUse";
  /** Name of the tool that was called */
  tool_name: string;
  /** Arguments that were passed to the tool */
  tool_input: Record<string, unknown>;
  /** Result returned from tool execution */
  tool_response: unknown;
}

/**
 * Input data for PostToolUseFailure hook
 */
export interface PostToolUseFailureHookInput extends HookInputBase {
  hook_event_name: "PostToolUseFailure";
  /** Name of the tool that failed */
  tool_name: string;
  /** Arguments that were passed to the tool */
  tool_input: Record<string, unknown>;
  /** Error message from tool execution failure */
  error: string;
  /** Whether the failure was caused by an interrupt */
  is_interrupt: boolean;
}

/**
 * Input data for UserPromptSubmit hook
 */
export interface UserPromptSubmitHookInput extends HookInputBase {
  hook_event_name: "UserPromptSubmit";
  /** The user's prompt text */
  prompt: string;
}

/**
 * Input data for Stop hook
 */
export interface StopHookInput extends HookInputBase {
  hook_event_name: "Stop";
  /** Whether a stop hook is currently processing */
  stop_hook_active: boolean;
}

/**
 * Input data for SubagentStart hook
 */
export interface SubagentStartHookInput extends HookInputBase {
  hook_event_name: "SubagentStart";
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Type/role of the subagent */
  agent_type: string;
}

/**
 * Input data for SubagentStop hook
 */
export interface SubagentStopHookInput extends HookInputBase {
  hook_event_name: "SubagentStop";
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Path to the subagent's conversation transcript */
  agent_transcript_path: string;
  /** Whether a stop hook is currently processing */
  stop_hook_active: boolean;
}

/**
 * Input data for PreCompact hook
 */
export interface PreCompactHookInput extends HookInputBase {
  hook_event_name: "PreCompact";
  /** What triggered compaction: "manual" or "auto" */
  trigger: "manual" | "auto";
  /** Custom instructions provided for compaction */
  custom_instructions?: string;
}

/**
 * Input data for PermissionRequest hook
 */
export interface PermissionRequestHookInput extends HookInputBase {
  hook_event_name: "PermissionRequest";
  /** Name of the tool requesting permission */
  tool_name: string;
  /** Arguments passed to the tool */
  tool_input: Record<string, unknown>;
  /** Suggested permission updates for the tool */
  permission_suggestions?: unknown[];
}

/**
 * Input data for SessionStart hook
 */
export interface SessionStartHookInput extends HookInputBase {
  hook_event_name: "SessionStart";
  /** How the session started: "startup", "resume", "clear", or "compact" */
  source: "startup" | "resume" | "clear" | "compact";
}

/**
 * Input data for SessionEnd hook
 */
export interface SessionEndHookInput extends HookInputBase {
  hook_event_name: "SessionEnd";
  /** Why the session ended */
  reason:
    | "clear"
    | "logout"
    | "prompt_input_exit"
    | "bypass_permissions_disabled"
    | "other";
}

/**
 * Input data for Notification hook
 */
export interface NotificationHookInput extends HookInputBase {
  hook_event_name: "Notification";
  /** Status message from the agent */
  message: string;
  /** Type of notification */
  notification_type:
    | "permission_prompt"
    | "idle_prompt"
    | "auth_success"
    | "elicitation_dialog";
  /** Optional title set by the agent */
  title?: string;
}

/**
 * Union of all possible hook input types
 */
export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | UserPromptSubmitHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PermissionRequestHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | NotificationHookInput;

/**
 * Context passed to hook callbacks
 */
export interface HookContext {
  /** AbortSignal for cancellation - pass to async operations like fetch() */
  signal: AbortSignal;
}

/**
 * Hook-specific output for PreToolUse hooks
 */
export interface PreToolUseHookSpecificOutput {
  hookEventName: "PreToolUse";
  /** Permission decision: "allow" (auto-approve), "deny" (block), or "ask" (prompt) */
  permissionDecision?: "allow" | "deny" | "ask";
  /** Explanation for the permission decision */
  permissionDecisionReason?: string;
  /** Modified tool input (requires permissionDecision: "allow") */
  updatedInput?: Record<string, unknown>;
  /** Additional context to add to the conversation */
  additionalContext?: string;
}

/**
 * Hook-specific output for PostToolUse hooks
 */
export interface PostToolUseHookSpecificOutput {
  hookEventName: "PostToolUse";
  /** Additional context to add to the conversation */
  additionalContext?: string;
}

/**
 * Hook-specific output for UserPromptSubmit hooks
 */
export interface UserPromptSubmitHookSpecificOutput {
  hookEventName: "UserPromptSubmit";
  /** Additional context to add to the conversation */
  additionalContext?: string;
}

/**
 * Hook-specific output for SessionStart hooks
 */
export interface SessionStartHookSpecificOutput {
  hookEventName: "SessionStart";
  /** Additional context to add to the conversation */
  additionalContext?: string;
}

/**
 * Hook-specific output for SubagentStart hooks
 */
export interface SubagentStartHookSpecificOutput {
  hookEventName: "SubagentStart";
  /** Additional context to add to the conversation */
  additionalContext?: string;
}

/**
 * Generic hook-specific output for other hook types
 */
export interface GenericHookSpecificOutput {
  hookEventName: HookEventName;
  [key: string]: unknown;
}

/**
 * Union of all hook-specific output types
 */
export type HookSpecificOutput =
  | PreToolUseHookSpecificOutput
  | PostToolUseHookSpecificOutput
  | UserPromptSubmitHookSpecificOutput
  | SessionStartHookSpecificOutput
  | SubagentStartHookSpecificOutput
  | GenericHookSpecificOutput;

/**
 * Output returned from hook callbacks
 */
export interface HookOutput {
  /** Whether the agent should continue after this hook (default: true) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
  /** Hide stdout from the transcript (default: false) */
  suppressOutput?: boolean;
  /** Message injected into the conversation for Claude to see */
  systemMessage?: string;
  /** Hook-specific output for controlling tool execution */
  hookSpecificOutput?: HookSpecificOutput;
}

/**
 * Hook callback function signature
 * @param input - Event-specific input data
 * @param toolUseId - Correlates PreToolUse and PostToolUse events
 * @param context - Contains AbortSignal for cancellation
 * @returns Promise resolving to hook output, or empty object to allow operation
 */
export type HookCallback = (
  input: HookInput,
  toolUseId: string | null,
  context: HookContext,
) => Promise<HookOutput>;

/**
 * Hook matcher configuration
 * Defines which tools trigger the callbacks and how they're processed
 */
export interface HookMatcher {
  /**
   * Regex pattern to match tool names.
   * Built-in tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, Task, etc.
   * MCP tools: mcp__<server>__<action>
   * Omit to match all tools.
   */
  matcher?: string;
  /** Array of callback functions to execute when the pattern matches */
  hooks: HookCallback[];
  /** Timeout in seconds (default: 60). Increase for hooks that make external API calls */
  timeout?: number;
}

/**
 * Hooks configuration object
 * Keys are hook event names, values are arrays of matchers
 */
export type HooksConfig = {
  [K in HookEventName]?: HookMatcher[];
};

// ── Account Types ──

// Shared "provider account" envelope returned by every adapter's
// getAccountInfo() (named for its first consumer, Codex). The `cursor` variant
// carries the Cursor account email + subscription tier from `agent about`.
export interface AccountInfo {
  account: {
    type: "apiKey";
  } | {
    type: "chatgpt";
    email: string | null;
    planType: string;
  } | {
    type: "amazonBedrock";
    usesCodexManagedCredentials: boolean;
  } | {
    type: "cursor";
    email: string;
    planType: string;
  } | {
    type: "claude";
    email: string;
    planType: string;
  } | {
    type: "copilot";
    /** GitHub login name; null when the CLI doesn't report one. */
    login: string | null;
  } | null;
  requiresOpenaiAuth: boolean;
  /**
   * Optional CLI health/version metadata (Cursor). `outdated` is true only when
   * the CLI is old enough that `agent about` / the parameterized model picker is
   * unsupported — drives an "update CLI" hint in Settings. We deliberately do
   * NOT gate on the `lab` channel: recent CLIs support effort controls without it.
   */
  cli?: {
    version: string | null;
    channel: string | null;
    outdated: boolean;
    compatibility?: "supported" | "newer" | "unsupported" | "unknown";
    minimumVersion?: string;
    testedProtocolVersion?: string;
  };
}

/** Result of a provider CLI self-update (e.g. `agent update`). */
export interface CliUpdateResult {
  success: boolean;
  /** Combined stdout/stderr from the update command, for display. */
  output: string;
}

// ── Plugin Marketplace Types ──

export interface PluginInterface {
  displayName?: string;
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities: string[];
  websiteUrl?: string;
  defaultPrompt?: string[];
  brandColor?: string;
  composerIcon?: string;
  logo?: string;
  screenshots: string[];
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
}

/** Where a plugin is installed (maps to the CLI `--scope` flag). */
export type PluginScope = "user" | "project" | "local";

export interface PluginInfo {
  id: string;
  name: string;
  source: { type: string; path: string };
  installed: boolean;
  enabled: boolean;
  installPolicy: "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";
  /** App-server availability after account and organization policy checks. */
  availability?: PluginAvailability;
  /** Why the plugin is unavailable, when the backend provides a reason. */
  disabledReason?: PluginDisabledReason | null;
  /** Raw plan identifiers that are eligible to install this plugin. */
  eligiblePlanTypes?: string[] | null;
  /** Unix timestamp in seconds when the plugin was installed. */
  installedAt?: number | null;
  authPolicy: "ON_INSTALL" | "ON_USE";
  interface: PluginInterface | null;
  /** Marketplace install count (popularity signal), when known. */
  installs?: number;
  /** True when an installed plugin has a newer version available. */
  updateAvailable?: boolean;
}

export interface MarketplaceInfo {
  name: string;
  path: string;
  interface: { displayName?: string } | null;
  plugins: PluginInfo[];
}

export interface PluginListResponse {
  marketplaces: MarketplaceInfo[];
  marketplaceLoadErrors: Array<{ marketplacePath: string; message: string }>;
  remoteSyncError: string | null;
  featuredPluginIds: string[];
}

export interface PluginSkillSummary {
  name: string;
  displayName?: string;
  path?: string;
  description?: string;
  shortDescription?: string;
  enabled: boolean;
}

export interface PluginAppSummary {
  id: string;
  name: string;
  needsAuth: boolean;
  description?: string;
  installUrl?: string;
  isAccessible?: boolean;
  isEnabled?: boolean;
  /** Grouping label from the marketplace, e.g. "Team communication". */
  category?: string;
  /** Remote logo URL resolved from the codex connector directory cache. */
  iconUrl?: string;
}

export interface PluginDetail {
  marketplaceName: string;
  marketplacePath: string;
  summary: PluginInfo;
  description: string | null;
  skills: PluginSkillSummary[];
  apps: PluginAppSummary[];
  mcpServers: string[];
  /** Marketplace-reported install count — only known for catalog-indexed plugins. */
  uniqueInstalls?: number | null;
  /** ISO timestamp of the plugin's last marketplace update, if known. */
  lastUpdated?: string | null;
}
