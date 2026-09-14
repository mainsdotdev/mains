// ─────────────────────────────────────────────────────────────
// Run Types
// ─────────────────────────────────────────────────────────────

import type { ModeId } from "../../../shared/modes";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type RunContextKind = "file" | "selection" | "diff" | "git" | "terminal" | "env" | "note";
export type RunArtifactKind = "patch" | "file" | "log" | "report" | "command_result" | "result" | "prompt_suggestion" | "image" | "document";
export type ToolCallStatus = "queued" | "running" | "done" | "error" | "canceled";

// ─────────────────────────────────────────────────────────────
// Run DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateRunPayload {
  id: string;
  accountId: string;
  workspaceId?: string;
  collectionId?: string;
  spaceId?: string;
  providerId: string;
  mode?: ModeId;
  model?: string;
  title?: string;
  goal?: string;
  status?: RunStatus;
  systemPrompt?: string;
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: Record<string, unknown>;
}

export interface UpdateRunPayload {
  title?: string;
  goal?: string;
  status?: RunStatus;
  model?: string;
  systemPrompt?: string;
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: Record<string, unknown>;
  startedAt?: Date;
  endedAt?: Date | null;
  lastError?: string | null;
  stopReason?: string | null;
  sessionId?: string | null;
}

/** The provider/mode pair that defines which UI experience owns a run. */
export interface RunExperienceOptions {
  accountId: string;
  providerId: string;
  mode: ModeId;
  limit?: number;
}

/** Optional narrowing for callers that load a workspace's run history. */
export interface WorkspaceRunListOptions {
  providerId?: string;
  mode?: ModeId;
  limit?: number;
}

export interface RunResponse {
  id: string;
  accountId: string;
  workspaceId: string | null;
  collectionId: string | null;
  spaceId: string | null;
  providerId: string;
  mode: ModeId;
  model: string | null;
  title: string | null;
  goal: string | null;
  status: RunStatus;
  systemPrompt: string | null;
  configSnapshot: Record<string, unknown> | null;
  toolPolicySnapshot: Record<string, unknown> | null;
  startedAt: Date | null;
  endedAt: Date | null;
  lastError: string | null;
  stopReason: string | null;
  sessionId: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArchivedRunWorkspaceResponse {
  id: string;
  name: string;
  isArchived: boolean;
  /** The workspace's project icon — what the sidebar prints beside it. */
  icon: string | null;
}

/** The project a chat is filed under — its collection, named and iconed. */
export interface ArchivedRunCollectionResponse {
  id: string;
  name: string;
  icon: string | null;
}

/**
 * An archived run enriched for Settings › Archive grouping. Developer runs are
 * grouped by workspace and chats by collection, so both labels travel with the
 * run — the renderer has no link from a run to either.
 */
export interface ArchivedRunResponse extends RunResponse {
  workspace: ArchivedRunWorkspaceResponse | null;
  collection: ArchivedRunCollectionResponse | null;
}

/**
 * A run that is still going, enriched with the workspace name the dock labels
 * it with. Only runs with a live session in the registry are reported — a
 * `running` row left behind by a crash is not something the user can jump back
 * into, so it never becomes a card.
 */
export interface ActiveRunResponse extends RunResponse {
  workspace: ActiveRunWorkspaceResponse | null;
}

export interface ActiveRunWorkspaceResponse {
  id: string;
  name: string;
}

/** A chat-sidebar row; Collection metadata is loaded through its own module. */
export type RecentRunResponse = RunResponse;

// ─────────────────────────────────────────────────────────────
// Run Context DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateRunContextPayload {
  runId: string;
  kind: RunContextKind;
  ref?: string;
  content?: string;
  entityId?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface RunContextResponse {
  id: number;
  runId: string;
  kind: RunContextKind;
  ref: string | null;
  content: string | null;
  entityId: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Run Artifact DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateRunArtifactPayload {
  runId: string;
  kind: RunArtifactKind;
  path?: string;
  content?: string;
  blobData?: Buffer;
  entityId?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface RunArtifactResponse {
  id: number;
  runId: string;
  kind: RunArtifactKind;
  path: string | null;
  content: string | null;
  blobData: Buffer | null;
  entityId: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Tool Call DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateToolCallPayload {
  accountId: string;
  runId: string;
  providerId?: string;
  toolId?: string;
  /** Provider tool-use id of the call that spawned this one (subagent children). */
  parentToolCallId?: string;
  toolName: string;
  status?: ToolCallStatus;
  input?: Record<string, unknown>;
  startedAt?: Date;
}

export interface UpdateToolCallPayload {
  status?: ToolCallStatus;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  startedAt?: Date;
  endedAt?: Date;
  latencyMs?: number;
  costMicros?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCallResponse {
  id: number;
  accountId: string;
  runId: string | null;
  providerId: string | null;
  toolId: string | null;
  /** Provider tool-use id of the spawning call — see CreateToolCallPayload. */
  parentToolCallId: string | null;
  toolName: string;
  status: ToolCallStatus;
  input: Record<string, unknown> | null;
  output: unknown | null;
  error: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  latencyMs: number | null;
  costMicros: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Run Turn DTOs
// ─────────────────────────────────────────────────────────────
export type RunTurnStatus = "active" | "completed";

export interface CreateRunTurnPayload {
  runId: string;
  turnIndex: number;
  promptContent?: string;
  startedAt?: Date;
}

export interface ModelUsageEntry {
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface UpdateRunTurnPayload {
  responseContent?: string;
  endedAt?: Date;
  elapsedMs?: number;
  status?: RunTurnStatus;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costMicros?: number;
  model?: string;
  modelUsage?: Record<string, ModelUsageEntry>;
  metadata?: Record<string, unknown>;
}

export interface RunTurnResponse {
  id: number;
  runId: string;
  turnIndex: number;
  promptContent: string | null;
  responseContent: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  elapsedMs: number | null;
  status: RunTurnStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costMicros: number | null;
  model: string | null;
  modelUsage: Record<string, ModelUsageEntry> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// File Attachment Types
// ─────────────────────────────────────────────────────────────

/** A file attachment serialized for IPC transport.
 *
 * Memory optimization: prefer `sourcePath` over inline base64 `data` whenever the
 * attachment already lives on disk (e.g. browser captures). Providing `sourcePath`
 * lets the adapter copy the file byte-for-byte instead of roundtripping base64
 * through IPC and Redux. Provide `data` only for in-memory payloads. */
export interface FileAttachment {
  /** Original file name */
  name: string;
  /** Attachment category */
  type: "image" | "document";
  /** Base64-encoded file data — optional when `sourcePath` is set. */
  data?: string;
  /** Absolute path to an existing file on disk. Read directly by the adapter. */
  sourcePath?: string;
  /** MIME type (e.g. "image/png", "application/pdf") */
  mimeType: string;
}

// ─────────────────────────────────────────────────────────────
// Execute Run DTOs (for starting work runs)
// ─────────────────────────────────────────────────────────────

/** Context item provided when starting a run */
export interface StartRunContextItem {
  kind: "file" | "diff" | "selection" | "note";
  ref?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/** Payload for starting a new work run */
export interface StartRunPayload {
  accountId: string;
  workspaceId?: string;
  collectionId?: string;
  spaceId?: string;
  providerId: string; // e.g., "copilot_cli"
  goal: string;
  model?: string;
  systemPrompt?: string;
  initialContext?: StartRunContextItem[];
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: Record<string, unknown>;
  /** File attachments (images/documents) serialized as base64 for IPC */
  attachments?: FileAttachment[];
  /** Structured context issues (displayed as chips in the UI) */
  contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
  /** Structured context signals (error reports, displayed as chips in the UI) */
  contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
  /** Structured context files (displayed as chips in the UI, injected into LLM prompt by adapter) */
  contextFiles?: Array<{ path: string }>;
  /** User-selected skills to invoke (displayed as chips in the UI, injected by adapter) */
  contextSkills?: Array<{
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
}

/** Response when a run is started */
export interface StartRunResponse {
  runId: string;
}

/** Payload for continuing an existing run (resume session) */
export interface ContinueRunPayload {
  runId: string;
  accountId: string;
  /** The follow-up message to send */
  message: string;
  /** Model to use for this continuation (overrides provider default) */
  model?: string | null;
  /** Additional context to add */
  additionalContext?: StartRunContextItem[];
  /** File attachments (images/documents) serialized as base64 for IPC */
  attachments?: FileAttachment[];
  /** Structured context issues to inject into this follow-up */
  contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
  /** Structured context signals (error reports) to inject into this follow-up */
  contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
  /** Structured context files to inject into this follow-up */
  contextFiles?: Array<{ path: string }>;
  /** User-selected skills to invoke for this follow-up */
  contextSkills?: Array<{
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
}

/** Response when a run is continued */
export interface ContinueRunResponse {
  runId: string;
  resumed: boolean;
}

export interface MoveRunToCollectionPayload {
  runId: string;
  accountId: string;
  collectionId: string | null;
}

/** Payload for forking an existing run's session into a new run */
export interface ForkRunPayload {
  /** The source run whose session will be forked */
  sourceRunId: string;
  accountId: string;
  /** The message/goal for the forked session */
  message: string;
  /** Additional context to add */
  additionalContext?: StartRunContextItem[];
  /** File attachments (images/documents) serialized as base64 for IPC */
  attachments?: FileAttachment[];
}

/** Response when a run is forked */
export interface ForkRunResponse {
  /** The new run ID created from the fork */
  runId: string;
  /** The source run that was forked from */
  sourceRunId: string;
}

/** Review target scope for native code review */
export interface ReviewTarget {
  type: "uncommittedChanges" | "baseBranch" | "commit" | "custom";
  branch?: string;
  sha?: string;
  title?: string;
  instructions?: string;
}

/** Payload for starting a native code review run */
export interface ReviewRunPayload {
  accountId: string;
  workspaceId: string;
  spaceId?: string;
  providerId: string;
  target: ReviewTarget;
  delivery?: "inline" | "detached";
  model?: string;
  systemPrompt?: string;
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: Record<string, unknown>;
}

/** Full run details with related data */
export interface RunDetailsResponse {
  run: RunResponse;
  context: RunContextResponse[];
  artifacts: RunArtifactResponse[];
  toolCalls: ToolCallResponse[];
  turns: RunTurnResponse[];
}

// ─────────────────────────────────────────────────────────────
// Tool Approval DTOs (interactive tool approval + AskUserQuestion)
// ─────────────────────────────────────────────────────────────
export interface ToolApprovalRequest {
  requestId: string;
  runId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  kind: "tool_approval" | "ask_user" | "elicitation";
  /** Short label shown above a structured question. */
  header?: string;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  /** Codex marks questions that expect a free-form "Other" response. */
  isOther?: boolean;
  /** Render free-form input as a masked password field. */
  isSecret?: boolean;
  /** Provider-requested timeout before the question auto-resolves. */
  autoResolutionMs?: number;
  /** MCP server that asked for input (kind: "elicitation"). */
  serverName?: string;
  /** "form" collects schema-driven fields; "url" sends the user to a browser. */
  elicitationMode?: "form" | "url";
  /** Destination to open (elicitationMode: "url"). */
  url?: string;
  /** JSON Schema describing the requested fields (elicitationMode: "form"). */
  requestedSchema?: Record<string, unknown>;
  /** Longer subtitle from the requester's permission-display metadata. */
  description?: string;
  timestamp: number;
}

/**
 * A request still waiting on the user, as `runs:listPendingApprovals` reports
 * it — the same shape the `runs:toolApprovalRequest` push carries, plus when
 * the broker will auto-deny it.
 */
export interface PendingApproval extends ToolApprovalRequest {
  /** Epoch ms after which the broker resolves the request as denied. */
  expiresAt: number;
}

export interface ToolApprovalResponse {
  requestId: string;
  approved: boolean;
  /**
   * Free-form answer. For a "form" elicitation this carries the collected
   * fields as a JSON object string, so the existing broker/IPC contract does
   * not need a second payload shape.
   */
  answer?: string;
}
