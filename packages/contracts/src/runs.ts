/**
 * Run / turn / tool-call / workspace wire shapes — mirrors of the response DTOs
 * in `mains/src/main/modules/runs/runs.dto.ts` and `workspace/workspace.dto.ts`.
 * Only fields the phone reads are guaranteed here; anything else that arrives
 * is ignored. Dates cross the wire tagged and are revived to `Date` by the
 * codec in ws-protocol.ts.
 */

export { MODE_IDS, providerModes } from "./modes";
export type { ModeId } from "./modes";
import type { ModeId } from "./modes";

export function modeLabel(mode: ModeId): string {
  switch (mode) {
    case "developer":
      return "Code";
    case "work":
      return "Work";
    case "chat":
      return "Chat";
  }
}
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type RunTurnStatus = "active" | "completed";
export type ToolCallStatus = "queued" | "running" | "done" | "error" | "canceled";

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
  startedAt: Date | null;
  endedAt: Date | null;
  lastError: string | null;
  stopReason: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  model: string | null;
  createdAt: Date;
}

export interface ToolCallResponse {
  id: number;
  runId: string | null;
  toolName: string;
  status: ToolCallStatus;
  input: Record<string, unknown> | null;
  output: unknown;
  error: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RunArtifactKind =
  | "patch"
  | "file"
  | "log"
  | "report"
  | "command_result"
  | "result"
  | "prompt_suggestion"
  | "image"
  | "document";

/**
 * `runArtifacts:getByRun` row. `metadata.kind` is the transcript's real
 * discriminator: "user-prompt" (a prompt), "thinking", "image",
 * "prompt_suggestion", or anything else (an assistant message).
 */
export interface RunArtifactResponse {
  id: number;
  runId: string;
  kind: RunArtifactKind;
  path: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * `runArtifacts:readImage` — an image artifact's pixels for a paired device,
 * which has no path to the Mac's disk and no signed protocol to read it by.
 */
export interface ReadArtifactImagePayload {
  artifactId: number;
  /** Longest side the image is scaled down to before it travels; the Mac caps it. */
  maxSide?: number;
}

export interface ArtifactImage {
  /** `image/jpeg` once the Mac has scaled it; the file's own type when sent as is. */
  mime: string;
  base64: string;
  /**
   * The pixels' size, or null when the Mac sent the file untouched — a format
   * it cannot decode (WebP, GIF, HEIC) but the phone can; the phone measures it.
   */
  width: number | null;
  height: number | null;
}

/** `space:getAll` row — a run's home: it pins the provider and the mode. */
export interface SpaceRecord {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  providerId: string;
  mode: ModeId;
  model: string | null;
  sortOrder: number | null;
  isArchived: boolean | null;
}

/** `space:update` payload — the phone only ever changes the mode. */
export interface SpaceModePayload {
  mode: ModeId;
}

/**
 * `providers:getEnabled` row (subset). `config` is the provider's settings
 * blob; the phone reads only the reasoning keys out of it (see `lib/models`).
 */
export interface ProviderSummary {
  id: string;
  displayName: string;
  isEnabled: boolean;
  config?: Record<string, unknown> | null;
}

/** Reasoning-effort levels, low → high (mirror of mains `shared/effort-levels.ts`). */
export { EFFORT_LEVELS } from "./effort-levels";
export type { EffortLevel } from "./effort-levels";
import type { EffortLevel } from "./effort-levels";

/** `providers:getModels` row — the subset of the desktop's `ModelInfo` the picker shows. */
export interface ModelInfo {
  id: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: EffortLevel[];
  supportsFastMode?: boolean;
}

/** `providers:modelsUpdated` push. */
export interface ProviderModelsUpdatedEvent {
  providerId: string;
}

/**
 * `providers:updateRunSettings` patch — only the keys present change.
 * `effortLevel` "" = reasoning off; `permissionMode` is one of the provider's
 * ids (see `lib/models`); `goalMode` / `planMode` are Codex-only.
 */
export interface UpdateRunSettingsPayload {
  effortLevel?: string;
  permissionMode?: string;
  fastMode?: boolean;
  goalMode?: boolean;
  planMode?: boolean;
}

/** `collections:list` row (subset). */
export interface CollectionResponse {
  id: string;
  name: string;
  icon: string | null;
  isArchived: boolean;
}

/** The subset of `runs:execute`'s payload the phone sends. */
/**
 * `providers:getSkills` row, as a paired device sees it. A narrowing of the
 * desktop's `SkillInfo`: what the composer's picker needs to list a skill and
 * echo it back as context, and nothing else.
 *
 * `iconSmall` / `iconLarge` are absolute paths on the Mac — a device cannot
 * read them, and carries them only so the value round-trips into the prompt's
 * artifact metadata untouched.
 */
export interface SkillSummary {
  name: string;
  displayName?: string;
  description?: string;
  shortDescription?: string;
  argumentHint?: string;
  /** False for skills the model invokes on its own — those never list. */
  userInvokable?: boolean;
  path?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  /** "plugin" | "mac" | "user" | "project" | "system" — the picker's buckets. */
  scope?: string;
}

/** `providers:getCommands` row — a slash command the provider offers. */
export interface CommandSummary {
  name: string;
  description?: string;
  argumentHint?: string;
  /** False for internal commands; those never list. */
  userFacing?: boolean;
}

/** A phone-local file serialized for the Mac's existing attachment pipeline. */
export interface FileAttachment {
  name: string;
  type: "image" | "document";
  /** Base64-encoded bytes without a data-URL prefix. */
  data: string;
  mimeType: string;
}

export interface StartRunPayload {
  accountId: string;
  spaceId: string;
  providerId: string;
  goal: string;
  workspaceId?: string;
  collectionId?: string;
  model?: string;
  /** Images/documents picked on the phone. */
  attachments?: FileAttachment[];
  /** Skills the composer attached — the Mac injects them and chips the prompt. */
  contextSkills?: SkillSummary[];
}

export interface StartRunResponse {
  runId: string;
}

export interface WorkspaceResponse {
  id: string;
  projectId: string;
  name: string;
  rootPath: string;
  /** backlog | todo | in_progress | in_review | done | canceled | duplicate */
  status?: string;
  isArchived: boolean;
  updatedAt: Date;
}

/** `workspace:listGitStates` row, also the `workspace:gitStateChanged` push. */
export interface WorkspaceGitState {
  workspaceId: string;
  branch: string | null;
  /** False once the workspace's folder is gone from disk. */
  pathExists: boolean;
}

/** `workspace:getLatestDiffSummary` — the last diff snapshot, without its text. */
export interface WorkspaceDiffSummary {
  id: string;
  workspaceId: string;
  runId: string | null;
  /** `shortstat` is git's "3 files changed, 286 insertions(+), 5 deletions(-)". */
  stats: { shortstat: string; files: number; newFiles?: number } | null;
  createdAt: Date;
}

/** `projects:list` row (subset) — a workspace's parent, named and iconed. */
export interface ProjectResponse {
  id: string;
  name: string;
  icon: string | null;
  isArchived?: boolean;
}

// ── Push events (payload shapes from mains's preload `runs.on*` listeners) ──

/** `runs:diffUpdated` push — the Mac snapshotted a workspace's diff for a run. */
export interface RunDiffUpdatedEvent {
  runId: string;
  workspaceId: string | null;
  ts: number;
}

export interface RunStatusChangedEvent {
  runId: string;
  status: string;
  ts: number;
}

export interface RunEventPersistedEvent {
  runId: string;
  ts: number;
}

/**
 * `runs:ephemeralEvent` push — an in-memory artifact snapshot used while an
 * agent message is still being written. It is never persisted or replayed;
 * clients recover from the normal run snapshot after reconnecting.
 */
export interface RunEphemeralEvent {
  runId: string;
  event: {
    type: "artifact";
    kind: string;
    content?: string;
    metadata?: Record<string, unknown>;
    streamId?: string;
  };
  ts: number;
}

export interface RunUpdatedEvent {
  runId: string;
  ts: number;
}

// ── Approvals (mirror of runs.dto.ts ToolApprovalRequest / PendingApproval) ──

export type ApprovalKind = "tool_approval" | "ask_user" | "elicitation";

/** The `runs:toolApprovalRequest` push — an agent waiting on the user. */
export interface ToolApprovalRequest {
  requestId: string;
  runId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  kind: ApprovalKind;
  header?: string;
  question?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  /** The question also accepts a free-form "Other" answer. */
  isOther?: boolean;
  isSecret?: boolean;
  /** Provider-requested timeout before the question auto-resolves. */
  autoResolutionMs?: number;
  serverName?: string;
  elicitationMode?: "form" | "url";
  url?: string;
  description?: string;
  timestamp: number;
}

/** `runs:listPendingApprovals` row: the request plus when the Mac auto-denies it. */
export interface PendingApproval extends ToolApprovalRequest {
  expiresAt: number;
}

export interface ToolApprovalResolvedEvent {
  requestId: string;
}

/**
 * Body of `runs:toolApprovalResponse`. `answer` formats mirror the desktop's
 * dialog: chosen option labels joined with ", " or free text for a question;
 * "acceptForSession" to allow a tool for the rest of the run; a JSON object
 * string for an elicitation form.
 */
export interface ToolApprovalResponse {
  requestId: string;
  approved: boolean;
  answer?: string;
}

/** `account:get` — the phone needs the id for run mutations. */
export interface AccountResponse {
  id: string;
  displayName: string | null;
}

/** The subset of `runs:continue`'s payload the phone sends. */
export interface ContinueRunPayload {
  runId: string;
  accountId: string;
  /** The follow-up message to send. */
  message: string;
  /** Model for this continuation; omitted = the provider's default. */
  model?: string | null;
  /** Images/documents picked on the phone. */
  attachments?: FileAttachment[];
  /** Skills attached to this follow-up. */
  contextSkills?: SkillSummary[];
}

export interface ContinueRunResponse {
  runId: string;
  resumed: boolean;
}

/**
 * The subset of `runs:fork`'s payload the phone sends. A fork branches the
 * source run's *session* into a new run — everything else (workspace, mode,
 * model, policy) is inherited from the source on the Mac, so the phone only
 * names the run to branch from and the message the branch opens with.
 */
export interface ForkRunPayload {
  sourceRunId: string;
  accountId: string;
  message: string;
}

export interface ForkRunResponse {
  runId: string;
  sourceRunId: string;
}

/** The broker's cap on how long any request may wait (user-input-broker.ts). */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export function isTerminalRunStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}
