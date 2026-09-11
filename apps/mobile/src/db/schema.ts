import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * The phone's projection of what it has seen from its backends. Not a copy of
 * mains.db: every row is shaped from a wire DTO, carries the `backend_id` it
 * came from, and is only ever written by the sync layer (Mac → phone). Screens
 * read these tables through live queries and never touch the socket.
 *
 * Schema changes go through `migrations.ts` (hand-written SQL, versioned by
 * `PRAGMA user_version`); keep this file and that one in step.
 */

export const backends = sqliteTable("backends", {
  backendId: text("backend_id").primaryKey(),
  name: text("name").notNull(),
  appVersion: text("app_version"),
  protocolVersion: integer("protocol_version"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  /** The space the phone last worked in; the sidebar switcher writes it. */
  lastSpaceId: text("last_space_id"),
});

/** Spaces: a run's home on the Mac — provider + mode. Selected in the sidebar. */
export const spaces = sqliteTable(
  "spaces",
  {
    backendId: text("backend_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    providerId: text("provider_id").notNull(),
    mode: text("mode").notNull(),
    model: text("model"),
    sortOrder: integer("sort_order"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.id] })],
);

/** Collections ("Projects" in the UI) — the grouping work/chat runs may be filed under. */
export const collections = sqliteTable(
  "collections",
  {
    backendId: text("backend_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.id] })],
);

/** Enabled providers on the Mac — to warn when a space's provider is off. */
export const providers = sqliteTable(
  "providers",
  {
    backendId: text("backend_id").notNull(),
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    /** Reasoning effort read out of the Mac's provider config ("" = off, "ultracode" folded). */
    effortLevel: text("effort_level"),
    thinkingMode: integer("thinking_mode", { mode: "boolean" }).notNull().default(false),
    /** Permission / sandbox mode id, under whichever key the provider uses on the Mac. */
    permissionMode: text("permission_mode"),
    fastMode: integer("fast_mode", { mode: "boolean" }).notNull().default(false),
    goalMode: integer("goal_mode", { mode: "boolean" }).notNull().default(false),
    planMode: integer("plan_mode", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.id] })],
);

/**
 * Permission to let one Mac send this phone's requests to one AI provider.
 * This is deliberately phone-owned, unlike the synced provider rows above:
 * a new Mac, provider, or disclosure version must ask again before sending.
 */
export const aiDataConsents = sqliteTable(
  "ai_data_consents",
  {
    backendId: text("backend_id").notNull(),
    providerId: text("provider_id").notNull(),
    disclosureVersion: integer("disclosure_version").notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.providerId] })],
);

/** `providers:getModels` rows: what a provider can run, and each model's effort levels. */
export const models = sqliteTable(
  "models",
  {
    backendId: text("backend_id").notNull(),
    providerId: text("provider_id").notNull(),
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    /** JSON array of supported effort levels; null when the model has none. */
    effortLevels: text("effort_levels"),
    supportsFastMode: integer("supports_fast_mode", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.providerId, t.id] })],
);

/**
 * `providers:getSkills` — what the composer's picker lists behind `@` / `$`.
 * Bucketed by `scope` at render time (plugin / mac app / plain skill), exactly
 * as the desktop's `bucketSkill` does.
 */
export const skills = sqliteTable(
  "skills",
  {
    backendId: text("backend_id").notNull(),
    providerId: text("provider_id").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    shortDescription: text("short_description"),
    argumentHint: text("argument_hint"),
    /** Absolute paths on the Mac: unreadable here, kept so context round-trips. */
    iconSmall: text("icon_small"),
    iconLarge: text("icon_large"),
    brandColor: text("brand_color"),
    scope: text("scope"),
    path: text("path"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.providerId, t.name] })],
);

/** `providers:getCommands` — the slash commands behind `/`. */
export const commands = sqliteTable(
  "commands",
  {
    backendId: text("backend_id").notNull(),
    providerId: text("provider_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    argumentHint: text("argument_hint"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.providerId, t.name] })],
);

/**
 * The model this phone picked per provider — local state, like the desktop's
 * own selection: it rides on `runs:execute` / `runs:continue` as `model`.
 */
export const modelChoices = sqliteTable(
  "model_choices",
  {
    backendId: text("backend_id").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.providerId] })],
);

/** The phone's remembered run target per space: which workspace / collection. */
export const spaceTargets = sqliteTable(
  "space_targets",
  {
    backendId: text("backend_id").notNull(),
    spaceId: text("space_id").notNull(),
    workspaceId: text("workspace_id"),
    collectionId: text("collection_id"),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.spaceId] })],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    backendId: text("backend_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    projectId: text("project_id"),
    /** Absolute path on the Mac. Unreadable here, but skills are scoped by it. */
    rootPath: text("root_path"),
    status: text("status"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    /** Current git branch; null = not a repo (or unknown yet). */
    branch: text("branch"),
    pathExists: integer("path_exists", { mode: "boolean" }).notNull().default(true),
    /** Size of the last diff snapshot; null = no diff yet. */
    diffAdditions: integer("diff_additions"),
    diffDeletions: integer("diff_deletions"),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.id] })],
);

/** Projects: what workspaces belong to — the Code sidebar's grouping and icon. */
export const projects = sqliteTable(
  "projects",
  {
    backendId: text("backend_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.id] })],
);

export const runs = sqliteTable(
  "runs",
  {
    backendId: text("backend_id").notNull(),
    id: text("id").notNull(),
    title: text("title"),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    providerId: text("provider_id").notNull(),
    model: text("model"),
    workspaceId: text("workspace_id"),
    collectionId: text("collection_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.backendId, t.id] }),
    index("idx_runs_backend_updated").on(t.backendId, t.updatedAt),
  ],
);

export const runTurns = sqliteTable(
  "run_turns",
  {
    backendId: text("backend_id").notNull(),
    runId: text("run_id").notNull(),
    turnIndex: integer("turn_index").notNull(),
    promptContent: text("prompt_content"),
    responseContent: text("response_content"),
    status: text("status").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    elapsedMs: integer("elapsed_ms"),
    model: text("model"),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.runId, t.turnIndex] })],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    backendId: text("backend_id").notNull(),
    runId: text("run_id").notNull(),
    /** The Mac's row id — stable across syncs, so it doubles as our key. */
    id: integer("id").notNull(),
    /** Provider-side tool-use id, used as the parent anchor for subagent work. */
    toolId: text("tool_id"),
    /** Provider tool-use id of the call that spawned this child call. */
    parentToolCallId: text("parent_tool_call_id"),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull(),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    /** Lifecycle metadata, including `subagent` and `task`. */
    metadataJson: text("metadata_json"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.backendId, t.runId, t.id] }),
    index("idx_tool_calls_run").on(t.backendId, t.runId, t.createdAt),
    index("idx_tool_calls_parent").on(t.backendId, t.runId, t.parentToolCallId),
  ],
);

/**
 * Everything the agent produced that isn't a tool call: prompts (`metadata.kind
 * = "user-prompt"`), assistant messages, logs, files, images. This — not
 * `run_turns.response_content` — is what the desktop builds its transcript
 * from, so the phone does the same. Blobs never come over; `path`/`content`
 * are enough to render.
 */
export const runArtifacts = sqliteTable(
  "run_artifacts",
  {
    backendId: text("backend_id").notNull(),
    runId: text("run_id").notNull(),
    /** The Mac's row id — insert-only there, so it doubles as the sync cursor. */
    id: integer("id").notNull(),
    kind: text("kind").notNull(),
    content: text("content"),
    path: text("path"),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.backendId, t.runId, t.id] }),
    index("idx_run_artifacts_run").on(t.backendId, t.runId, t.createdAt),
  ],
);

/**
 * Agent requests waiting on the user, as the Mac's in-memory broker reports
 * them. Replaced wholesale on every snapshot and edited by the request /
 * resolved pushes; rows past `expires_at` are already denied on the Mac.
 */
export const pendingApprovals = sqliteTable(
  "pending_approvals",
  {
    backendId: text("backend_id").notNull(),
    requestId: text("request_id").notNull(),
    runId: text("run_id").notNull(),
    kind: text("kind").notNull(),
    toolName: text("tool_name").notNull(),
    header: text("header"),
    question: text("question"),
    optionsJson: text("options_json"),
    multiSelect: integer("multi_select", { mode: "boolean" }).notNull().default(false),
    description: text("description"),
    toolInputJson: text("tool_input_json"),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    // v4 — what the answer UI needs beyond the text
    isOther: integer("is_other", { mode: "boolean" }).notNull().default(false),
    isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(false),
    elicitationMode: text("elicitation_mode"),
    url: text("url"),
  },
  (t) => [
    primaryKey({ columns: [t.backendId, t.requestId] }),
    index("idx_pending_approvals_run").on(t.backendId, t.runId),
  ],
);

/** Per-run incremental-sync cursors — the phone-side twin of desktop's run cache. */
export const syncCursors = sqliteTable(
  "sync_cursors",
  {
    backendId: text("backend_id").notNull(),
    runId: text("run_id").notNull(),
    /** Max tool-call `updatedAt` seen; the next fetch asks for newer only. */
    toolUpdatedAt: integer("tool_updated_at", { mode: "timestamp_ms" }),
    /** Max artifact id seen (artifacts are insert-only on the Mac). */
    artifactId: integer("artifact_id"),
    fullSyncedAt: integer("full_synced_at", { mode: "timestamp_ms" }),
  },
  (t) => [primaryKey({ columns: [t.backendId, t.runId] })],
);

export type BackendRow = typeof backends.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunTurnRow = typeof runTurns.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type RunArtifactRow = typeof runArtifacts.$inferSelect;
export type PendingApprovalRow = typeof pendingApprovals.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type AiDataConsentRow = typeof aiDataConsents.$inferSelect;
export type SpaceTargetRow = typeof spaceTargets.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type CommandRow = typeof commands.$inferSelect;
