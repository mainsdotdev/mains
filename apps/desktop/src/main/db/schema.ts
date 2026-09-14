import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { PROVIDER_IDS, SUPPORTED_PROVIDER_IDS } from "../../shared/provider-ids";
import { DEFAULT_MODE_ID, MODE_IDS } from "../../shared/modes";

/* -----------------------------
   ACCOUNTS / SETTINGS
------------------------------ */

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey().notNull().default("default"),
    displayName: text("display_name"),
    email: text("email"),
    company: text("company"),
    jobTitle: text("job_title"),
    timezone: text("timezone"),
    locale: text("locale"),
    website: text("website"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_accounts_email").on(t.email),
    index("idx_accounts_display_name").on(t.displayName),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey().notNull().default("default"),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  activeSpaceId: text("active_space_id").references(() => spaces.id, {
    onDelete: "set null",
  }),

  // Off for fresh installs: most people start on one repo and one branch, and
  // the isolated copy only earns its keep once several tasks run at once. The
  // default is read at insert time only, so installs that already carry a
  // value — including everyone seeded before this flipped — keep theirs.
  enableWorktrees: integer("enable_worktrees", { mode: "boolean" })
    .notNull()
    .default(false),

  showToolCalls: integer("show_tool_calls", { mode: "boolean" })
    .notNull()
    .default(true),

  preventSleepDuringRuns: integer("prevent_sleep_during_runs", { mode: "boolean" })
    .notNull()
    .default(false),

  notifyOnRunComplete: integer("notify_on_run_complete", { mode: "boolean" })
    .notNull()
    .default(true),

  notifyOnToolApproval: integer("notify_on_tool_approval", { mode: "boolean" })
    .notNull()
    .default(true),

  showMenuBarIcon: integer("show_menu_bar_icon", { mode: "boolean" })
    .notNull()
    .default(true),

  // "This machine" backend exposure — persisted so it survives an app restart.
  backendRemoteAccess: integer("backend_remote_access", { mode: "boolean" })
    .notNull()
    .default(false),
  backendLanAccess: integer("backend_lan_access", { mode: "boolean" })
    .notNull()
    .default(false),
  backendTailscaleHttps: integer("backend_tailscale_https", { mode: "boolean" })
    .notNull()
    .default(false),
  // Stable identity of THIS install as a backend. Minted on first use and never
  // rotated: a paired phone keys its saved backend on it, so it must outlive
  // restarts and pairing-token changes. Null until first minted.
  backendId: text("backend_id"),

  commitInstructions: text("commit_instructions").notNull().default(""),
  prInstructions: text("pr_instructions").notNull().default(""),

  seedVersion: integer("seed_version").notNull().default(0),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/* -----------------------------
   PAIRED DEVICES (phones / remote clients of THIS backend)
------------------------------ */

export const pairedDevices = sqliteTable(
  "paired_devices",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    platform: text("platform", { enum: ["ios", "android", "web", "unknown"] })
      .notNull()
      .default("unknown"),
    appVersion: text("app_version"),
    // sha256 hex of the device token; the token itself is never stored.
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    // Revoked rows stay for the audit trail but no longer authenticate.
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("uniq_paired_devices_token_hash").on(t.tokenHash),
    index("idx_paired_devices_revoked_at").on(t.revokedAt),
  ],
);

/* -----------------------------
   COMMAND RECEIPTS (idempotent mutations from paired devices)
------------------------------ */

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    deviceId: text("device_id")
      .notNull()
      .references(() => pairedDevices.id, { onDelete: "cascade" }),
    /** Chosen by the device; the same id on a retry replays `result`. */
    commandId: text("command_id").notNull(),
    channel: text("channel").notNull(),
    // The ServiceResponse the command produced, wire-encoded (Date tags and
    // all) so a replay sends byte-for-byte what the first attempt got.
    result: text("result").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.commandId] }),
    index("idx_command_receipts_created_at").on(t.createdAt),
  ],
);

/* -----------------------------
   PROVIDERS (LLM / agent runtimes)
   - shared by runs (terminal/code-writing flow)
------------------------------ */

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(), // "copilot_cli" | "claude_code" | ...
    kind: text("kind", { enum: ["llm_runtime", "agent_runtime"] }).notNull(),
    displayName: text("display_name").notNull(),
    isEnabled: integer("is_enabled", { mode: "boolean" })
      .notNull()
      .default(true),

    // e.g. { baseUrl, binaryPath, envVarHints, ... }
    config: text("config"), // JSON

    // e.g. { toolCalling: true, streaming: true, jsonSchema: true, ... }
    capabilities: text("capabilities"), // JSON

    defaultModel: text("default_model"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_providers_kind").on(t.kind),
    index("idx_providers_enabled").on(t.isEnabled),
    index("idx_providers_updated").on(t.updatedAt),
    check(
      "check_providers_config_json",
      sql`json_valid(${t.config}) OR ${t.config} IS NULL`,
    ),
    check(
      "check_providers_capabilities_json",
      sql`json_valid(${t.capabilities}) OR ${t.capabilities} IS NULL`,
    ),
  ],
);

/* -----------------------------
   PROJECTS (group workspaces by shared remote origin)
------------------------------ */

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(), // original clone/source repo path
    workspacesPath: text("workspaces_path"), // worktree directory for this project
    branches: text("branches"), // JSON array of branch names
    remoteOrigin: text("remote_origin"), // normalized origin URL — null for local-only projects
    defaultBranch: text("default_branch"),
    setupScript: text("setup_script"),
    runScript: text("run_script"),
    archiveScript: text("archive_script"),
    icon: text("icon"), // "icon:rocket", "emoji:🚀", or null
    commitInstructions: text("commit_instructions"),
    prInstructions: text("pr_instructions"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("uniq_projects_account_origin")
      .on(t.accountId, t.remoteOrigin)
      .where(sql`${t.remoteOrigin} IS NOT NULL`),
    uniqueIndex("uniq_projects_account_root")
      .on(t.accountId, t.rootPath)
      .where(sql`${t.remoteOrigin} IS NULL`),
    index("idx_projects_account").on(t.accountId),
    index("idx_projects_remote_origin").on(t.remoteOrigin),
    index("idx_projects_updated").on(t.updatedAt),
    check(
      "check_projects_branches_json",
      sql`json_valid(${t.branches}) OR ${t.branches} IS NULL`,
    ),
  ],
);

/* -----------------------------
   WORKSPACES (local projects / repos)
------------------------------ */

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(), // uuid
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }).notNull(),

    name: text("name").notNull(),
    rootPath: text("root_path").notNull(), // local absolute path
    repoUrl: text("repo_url"),
    baseBranch: text("base_branch"), // PR target; current branch is always read live from git
    metadata: text("metadata"), // JSON (optional)
    status: text("status", {
      enum: ["backlog", "todo", "in_progress", "in_review", "done", "canceled", "duplicate"],
    })
      .notNull()
      .default("todo"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_workspaces_account").on(t.accountId),
    index("idx_workspaces_project").on(t.projectId),
    uniqueIndex("uniq_workspaces_account_root").on(t.accountId, t.rootPath),
    index("idx_workspaces_status").on(t.status),
    index("idx_workspaces_updated").on(t.updatedAt),
    check(
      "check_workspaces_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);

/* -----------------------------
   PROJECT RESOURCES (pivot table)
   Links projects to connection_resources
------------------------------ */

export const projectResources = sqliteTable(
  "project_resources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => connectionResources.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("uniq_project_resources").on(t.projectId, t.resourceId),
    index("idx_project_resources_project").on(t.projectId),
    index("idx_project_resources_resource").on(t.resourceId),
  ],
);

/* -----------------------------
   COLLECTIONS (group non-developer runs)
------------------------------ */

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_collections_account").on(t.accountId),
    index("idx_collections_updated").on(t.updatedAt),
  ],
);

/* -----------------------------
   COLLECTION SOURCES (canonical context owned by a Collection)
------------------------------ */

export const collectionSources = sqliteTable(
  "collection_sources",
  {
    id: text("id").primaryKey(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["file", "text"] }).notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_collection_sources_collection").on(t.collectionId),
    uniqueIndex("uniq_collection_sources_content").on(
      t.collectionId,
      t.contentHash,
    ),
    check("check_collection_sources_kind", sql`${t.kind} IN ('file', 'text')`),
    check("check_collection_sources_byte_size", sql`${t.byteSize} >= 0`),
  ],
);

/* -----------------------------
   RUNS (terminal/code-writing flow)
------------------------------ */

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(), // uuid
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),

    collectionId: text("collection_id").references(() => collections.id, {
      onDelete: "set null",
    }),

    // optional: which space/profile initiated this run (tool policies etc.)
    spaceId: text("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),

    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),

    // experience mode snapshot from the space at run start — the run keeps
    // rendering/resuming under its original mode even if the space changes
    mode: text("mode", { enum: MODE_IDS }).notNull().default(DEFAULT_MODE_ID),

    model: text("model"), // snapshot
    title: text("title"),
    goal: text("goal"), // user intent

    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "canceled"],
    })
      .notNull()
      .default("queued"),

    // snapshots for reproducibility
    systemPrompt: text("system_prompt"),
    configSnapshot: text("config_snapshot"), // JSON (temp/top_p/max_tokens/etc)
    toolPolicySnapshot: text("tool_policy_snapshot"), // JSON (allow/deny, etc)

    startedAt: integer("started_at", { mode: "timestamp" }),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    stopReason: text("stop_reason"),
    sessionId: text("session_id"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_runs_account_created").on(t.accountId, t.createdAt),
    index("idx_runs_account_status").on(t.accountId, t.status),
    index("idx_runs_provider").on(t.providerId),
    index("idx_runs_mode").on(t.mode),
    index("idx_runs_workspace").on(t.workspaceId),
    index("idx_runs_collection").on(t.collectionId),
    index("idx_runs_space").on(t.spaceId),
    index("idx_runs_updated").on(t.updatedAt),
    check(
      "check_runs_config_snapshot_json",
      sql`json_valid(${t.configSnapshot}) OR ${t.configSnapshot} IS NULL`,
    ),
    check(
      "check_runs_tool_policy_snapshot_json",
      sql`json_valid(${t.toolPolicySnapshot}) OR ${t.toolPolicySnapshot} IS NULL`,
    ),
  ],
);

/* -----------------------------
   RUN TURNS (per-turn tracking with usage)
------------------------------ */

export const runTurns = sqliteTable(
  "run_turns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    promptContent: text("prompt_content"),
    responseContent: text("response_content"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    elapsedMs: integer("elapsed_ms"),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    // Usage fields
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    costMicros: integer("cost_micros"), // USD * 1_000_000
    model: text("model"),
    modelUsage: text("model_usage"), // JSON: Record<modelName, { costUSD, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }>
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_run_turns_run").on(t.runId),
    index("idx_run_turns_run_index").on(t.runId, t.turnIndex),
    check(
      "check_run_turns_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);

/* -----------------------------
   RUN CONTEXT (what the run looked at / was given)
------------------------------ */

export const runContext = sqliteTable(
  "run_context",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),

    kind: text("kind", {
      enum: ["file", "selection", "diff", "git", "terminal", "env", "note"],
    }).notNull(),

    // path / commit / command / etc.
    ref: text("ref"),

    // small context inline; if large, store as entity + chunks and link via entityId
    content: text("content"),
    entityId: text("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),

    contentHash: text("content_hash"), // sha256/xxhash as string
    metadata: text("metadata"), // JSON (line ranges, mime, size, etc.)

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_run_context_run").on(t.runId),
    index("idx_run_context_kind").on(t.kind),
    index("idx_run_context_entity").on(t.entityId),
    index("idx_run_context_hash").on(t.contentHash),
    check(
      "check_run_context_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);

/* -----------------------------
   RUN ARTIFACTS (patches, logs, files, reports)
------------------------------ */

export const runArtifacts = sqliteTable(
  "run_artifacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),

    kind: text("kind", {
      enum: [
        "patch",
        "file",
        "log",
        "report",
        "command_result",
        "result",
        "prompt_suggestion",
        "image",
        "document",
      ],
    }).notNull(),

    // for files/patches
    path: text("path"),
    content: text("content"),
    blobData: blob("blob_data"),

    // or store big content as entity
    entityId: text("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),

    contentHash: text("content_hash"),
    metadata: text("metadata"), // JSON (exitCode, bytes, language, etc.)

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_run_artifacts_run").on(t.runId),
    index("idx_run_artifacts_kind").on(t.kind),
    index("idx_run_artifacts_path").on(t.path),
    index("idx_run_artifacts_entity").on(t.entityId),
    index("idx_run_artifacts_hash").on(t.contentHash),
    check(
      "check_run_artifacts_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);
/* -----------------------------
   WORKSPACE DIFFS (git diff captured after a run, persisted per workspace)
------------------------------ */

export const workspaceDiffs = sqliteTable(
  "workspace_diffs",
  {
    id: text("id").primaryKey(), // uuid
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),

    baseRef: text("base_ref"), // HEAD sha captured at run start
    diffText: text("diff_text").notNull(), // unified diff patch
    filesJson: text("files_json"), // JSON array of changed file paths
    statsJson: text("stats_json"), // JSON object { shortstat, files, newFiles }
    // JSON array — the subset of files_json that wasn't tracked at capture
    // time. The diff text can't carry this: a staged-new file and an untracked
    // one both render as `new file mode …`.
    untrackedJson: text("untracked_json"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_workspace_diffs_workspace").on(t.workspaceId),
    index("idx_workspace_diffs_created").on(t.createdAt),
    check(
      "check_workspace_diffs_files_json",
      sql`json_valid(${t.filesJson}) OR ${t.filesJson} IS NULL`,
    ),
    check(
      "check_workspace_diffs_stats_json",
      sql`json_valid(${t.statsJson}) OR ${t.statsJson} IS NULL`,
    ),
    check(
      "check_workspace_diffs_untracked_json",
      sql`json_valid(${t.untrackedJson}) OR ${t.untrackedJson} IS NULL`,
    ),
  ],
);

/* -----------------------------
   REVIEWS (workspace-level review records)
------------------------------ */

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status", {
      enum: ["open", "in_review", "approved", "rejected"],
    })
      .notNull()
      .default("open"),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_reviews_workspace").on(t.workspaceId),
    index("idx_reviews_status").on(t.status),
    index("idx_reviews_updated").on(t.updatedAt),
    check(
      "check_reviews_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);

/* -----------------------------
   REVIEW FINDINGS (file-level review results)
------------------------------ */

export const reviewFindings = sqliteTable(
  "review_findings",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    severity: text("severity", {
      enum: ["critical", "warning", "info"],
    }).notNull(),
    file: text("file").notNull(),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    message: text("message").notNull(),
    reason: text("reason").notNull(),
    suggestion: text("suggestion"),
    validated: integer("validated", { mode: "boolean" })
      .notNull()
      .default(false),
    isApproved: integer("is_approved", { mode: "boolean" })
      .notNull()
      .default(false),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_review_findings_review").on(t.reviewId),
    index("idx_review_findings_severity").on(t.severity),
    check(
      "check_review_findings_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);

/* -----------------------------
   WORKSPACE ACTIVITY (unified activity timeline)
------------------------------ */

export const workspaceActivity = sqliteTable(
  "workspace_activity",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["diff", "review", "finding", "commit", "pr", "push", "pull"],
    }).notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    metadata: text("metadata"),
    refId: text("ref_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_workspace_activity_workspace").on(t.workspaceId),
    index("idx_workspace_activity_type").on(t.type),
    index("idx_workspace_activity_created").on(t.createdAt),
    check(
      "check_workspace_activity_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);


/* -----------------------------
   TOOL CALLS (invocation log)
   - can be used by  runs
   - link to runId when terminal/code-writing
------------------------------ */

// tool_calls
export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),

    providerId: text("provider_id").references(() => providers.id, {
      onDelete: "set null",
    }),

    // ✅ NEW: provider tool call correlation id (toolu_..., call_id, etc.)
    toolCallId: text("tool_call_id"),

    // ✅ NEW (optional): nested/child tool call linkage
    parentToolCallId: text("parent_tool_call_id"),

    toolName: text("tool_name").notNull(),

    status: text("status", {
      enum: ["queued", "running", "done", "error", "canceled"],
    })
      .notNull()
      .default("queued"),

    input: text("input"),
    output: text("output"),
    error: text("error"),

    startedAt: integer("started_at", { mode: "timestamp" }),
    endedAt: integer("ended_at", { mode: "timestamp" }),

    latencyMs: integer("latency_ms"),
    costMicros: integer("cost_micros"),

    metadata: text("metadata"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    // Bumped on every update (status/output/etc.). Lets the renderer fetch only
    // rows changed since its last sync instead of re-reading the whole run.
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_tool_calls_account_created").on(t.accountId, t.createdAt),
    index("idx_tool_calls_run").on(t.runId),
    index("idx_tool_calls_provider").on(t.providerId),
    index("idx_tool_calls_status").on(t.status),

    // ✅ NEW: fast lookup for end event updates
    index("idx_tool_calls_run_toolcallid").on(t.runId, t.toolCallId),

    // Incremental sync cursor: changed-since-timestamp lookups per run.
    index("idx_tool_calls_run_updated").on(t.runId, t.updatedAt),

    check(
      "check_tool_calls_input_json",
      sql`json_valid(${t.input}) OR ${t.input} IS NULL`,
    ),
    check(
      "check_tool_calls_output_json",
      sql`json_valid(${t.output}) OR ${t.output} IS NULL`,
    ),
    check(
      "check_tool_calls_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);
/* -----------------------------
   CONNECTIONS / TOKENS / SYNC
------------------------------ */

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(), // github|linear|notion|gmail|rss|...
    type: text("type").notNull(), // oauth|api_key|local|...
    displayName: text("display_name"),
    description: text("description"),
    status: text("status", {
      enum: ["active", "revoked", "error", "disabled"],
    })
      .notNull()
      .default("active"),
    scopes: text("scopes"), // JSON
    metadata: text("metadata"), // JSON
    connectedAt: integer("connected_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_connections_provider").on(t.provider),
    index("idx_connections_status").on(t.status),
    index("idx_connections_connected_at").on(t.connectedAt),
    index("idx_connections_updated_at").on(t.updatedAt),
    check(
      "check_connections_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
    check(
      "check_connections_scopes_json",
      sql`json_valid(${t.scopes}) OR ${t.scopes} IS NULL`,
    ),
  ],
);

export const connectionTokens = sqliteTable(
  "connection_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    accessTokenEnc: blob("access_token_enc"),
    refreshTokenEnc: blob("refresh_token_enc"),
    tokenType: text("token_type"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    tokenHash: blob("token_hash"),
    keyVersion: integer("key_version").notNull().default(1),
    isCurrent: integer("is_current", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_ct_conn").on(t.connectionId),
    index("idx_ct_current").on(t.isCurrent),
    index("idx_ct_expires").on(t.expiresAt),
    index("idx_ct_created_at").on(t.createdAt),
    index("idx_ct_token_hash").on(t.tokenHash),
    uniqueIndex("uniq_ct_conn_current")
      .on(t.connectionId)
      .where(sql`${t.isCurrent} = 1`),
  ],
);


export const connectionResources = sqliteTable(
  "connection_resources",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // repo full_name, notion db id, ...
    kind: text("kind").notNull(), // github_repo|notion_db|rss_feed|...
    name: text("name"),
    url: text("url"),
    selected: integer("selected", { mode: "boolean" }).notNull().default(true),
    metadata: text("metadata"), // JSON
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("uniq_resources_conn_ext").on(t.connectionId, t.externalId),
    index("idx_resources_kind").on(t.kind),
    index("idx_resources_selected").on(t.selected),
    index("idx_resources_conn").on(t.connectionId),
    index("idx_resources_last_seen").on(t.lastSeenAt),
    check(
      "check_resources_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);

/* -----------------------------
   SPACES / CONNECTION STATE
------------------------------ */

export const connectionStates = sqliteTable(
  "connection_states",
  {
    id: text("id").primaryKey(), // "github" | "notion" | "raindrop" | ...
    isConnected: integer("is_connected", { mode: "boolean" })
      .notNull()
      .default(false),
    connectionId: text("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name"),
    category: text("category"),
    iconPath: text("icon_path"),
    sortOrder: integer("sort_order").notNull().default(0),
    enabledFeatures: text("enabled_features"), // JSON
    config: text("config"), // JSON
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },

  (t) => [
    index("idx_connection_states_connected").on(t.isConnected),
    index("idx_connection_states_sort").on(t.sortOrder),
    index("idx_connection_states_updated_at").on(t.updatedAt),
    index("idx_connection_states_created_at").on(t.createdAt),
    check(
      "check_enabled_features_json",
      sql`json_valid(${t.enabledFeatures}) OR ${t.enabledFeatures} IS NULL`,
    ),
    check(
      "check_config_json",
      sql`json_valid(${t.config}) OR ${t.config} IS NULL`,
    ),
  ],
);

export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt"),
    model: text("model"),
    icon: text("icon"),
    themeConfig: text("theme_config"), // JSON
    // Agent engine this space drives on /code. Enum (not FK) so tests can
    // insert spaces without seeding providers; writes are validated against
    // the same id set in space.validation.ts.
    providerId: text("provider_id", { enum: SUPPORTED_PROVIDER_IDS })
      .notNull()
      .default(PROVIDER_IDS.claude),
    // Experience the space drives (developer / work / chat) — UI shape comes
    // from the renderer's MODE_CONFIGS table keyed by this value.
    mode: text("mode", { enum: MODE_IDS }).notNull().default(DEFAULT_MODE_ID),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("uniq_spaces_account_slug").on(t.accountId, t.slug),
    uniqueIndex("uniq_spaces_account_name").on(t.accountId, t.name),
    index("idx_spaces_account").on(t.accountId),
    index("idx_spaces_sort").on(t.sortOrder),
    index("idx_spaces_updated").on(t.updatedAt),
    check(
      "check_spaces_theme_json",
      sql`json_valid(${t.themeConfig}) OR ${t.themeConfig} IS NULL`,
    ),
  ],
);




/* -----------------------------
   UNIFIED CANONICAL CONTENT: ENTITIES
------------------------------ */

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(), // uuid
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    // What is it?
    kind: text("kind").notNull(),
    // examples: task|issue|doc|bookmark|rss_article|podcast_episode|playlist|email|video|hn_item

    // Source / mapping
    connectionId: text("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    resourceId: text("resource_id").references(() => connectionResources.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id"), // provider id
    url: text("url"),

    // Common searchable content
    title: text("title"),
    body: text("body"), // markdown/plain (long)
    summary: text("summary"), // short (for lists/LLM)
    metadata: text("metadata"), // JSON provider-specific

    // Timestamps
    occurredAt: integer("occurred_at", { mode: "timestamp" }), // publishedAt / happenedAt
    sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp" }),
    etag: text("etag"),
    isDeleted: integer("is_deleted", { mode: "boolean" })
      .notNull()
      .default(false),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("uniq_entities_source").on(
      t.connectionId,
      t.kind,
      t.externalId,
    ),
    index("idx_entities_account_kind").on(t.accountId, t.kind),
    index("idx_entities_conn").on(t.connectionId),
    index("idx_entities_resource").on(t.resourceId),
    index("idx_entities_occurred").on(t.occurredAt),
    index("idx_entities_updated").on(t.updatedAt),
    check(
      "check_entities_metadata_json",
      sql`json_valid(${t.metadata}) OR ${t.metadata} IS NULL`,
    ),
  ],
);


/* -----------------------------
   ACTIONABLE DOMAIN TABLES
   - keep canonical text in entities
   - keep queryable state here
------------------------------ */

export const tasks = sqliteTable(
  "tasks",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),

    status: text("status", { enum: ["todo", "doing", "done", "canceled"] })
      .notNull()
      .default("todo"),
    dueAt: integer("due_at", { mode: "timestamp" }),
    priority: integer("priority").notNull().default(0),
    labels: text("labels"), // JSON array
  },
  (t) => [
    index("idx_tasks_status").on(t.status),
    index("idx_tasks_due").on(t.dueAt),
    check(
      "check_tasks_labels_json",
      sql`json_valid(${t.labels}) OR ${t.labels} IS NULL`,
    ),
  ],
);

export const issues = sqliteTable(
  "issues",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(), // github|linear|jira
    state: text("state").notNull(), // open|closed|in_progress|...
    number: integer("number"), // github issue no
    repo: text("repo"), // owner/name or project key
    assignee: text("assignee"),
    labels: text("labels"), // JSON array
    closedAt: integer("closed_at", { mode: "timestamp" }),
    priority: integer("priority").notNull().default(0),
  },
  (t) => [
    index("idx_issues_provider_state").on(t.provider, t.state),
    index("idx_issues_repo").on(t.repo),
    check(
      "check_issues_labels_json",
      sql`json_valid(${t.labels}) OR ${t.labels} IS NULL`,
    ),
  ],
);

/* -----------------------------
   SIGNALS (error reports, crashes, alerts, feedback)
------------------------------ */

export const signals = sqliteTable(
  "signals",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),

    source: text("source").notNull(), // sentry|crashlytics|slack|manual|datadog|logr ocket|...
    level: text("level", {
      enum: ["fatal", "critical", "error", "warning", "info"],
    })
      .notNull()
      .default("error"),
    category: text("category", {
      enum: ["crash", "bug", "alert", "feedback", "exception", "other"],
    })
      .notNull()
      .default("bug"),

    state: text("state", {
      enum: ["open", "resolved", "ignored", "regressed"],
    })
      .notNull()
      .default("open"),

    // Sentry/Crashlytics specific but universally useful
    eventCount: integer("event_count").notNull().default(1),
    affectedUsers: integer("affected_users"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),

    // Code context
    stackTrace: text("stack_trace"),
    file: text("file"),         // source file path
    function: text("function"), // function/method name
    line: integer("line"),

    assignee: text("assignee"),
    labels: text("labels"),     // JSON array
    priority: integer("priority").notNull().default(0),

    // Link to project (optional — for filtering signals by project)
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),

    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_signals_source").on(t.source),
    index("idx_signals_level").on(t.level),
    index("idx_signals_category").on(t.category),
    index("idx_signals_state").on(t.state),
    index("idx_signals_project").on(t.projectId),
    index("idx_signals_last_seen").on(t.lastSeenAt),
    check(
      "check_signals_labels_json",
      sql`json_valid(${t.labels}) OR ${t.labels} IS NULL`,
    ),
  ],
);

/* -----------------------------
   AUTOMATIONS (scheduled jobs)
------------------------------ */

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["sync", "report", "cleanup", "custom"],
    }).notNull(),

    // What to run: "sync:github", "sync:all", "report:daily", etc.
    action: text("action").notNull(),

    // Simple interval in minutes (no cron complexity for a desktop app)
    intervalMinutes: integer("interval_minutes").notNull(),

    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),

    // Optional: filter/config for the action
    config: text("config"), // JSON

    // Tracking
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_automations_account").on(t.accountId),
    index("idx_automations_kind").on(t.kind),
    index("idx_automations_active").on(t.isActive),
    index("idx_automations_next_run").on(t.nextRunAt),
    check(
      "check_automations_config_json",
      sql`json_valid(${t.config}) OR ${t.config} IS NULL`,
    ),
  ],
);

/* -----------------------------
   AUTOMATION RUNS (execution log)
------------------------------ */

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),

    status: text("status", {
      enum: ["running", "success", "error"],
    }).notNull(),

    result: text("result"), // JSON — action-specific output (SyncJobResult, etc.)
    error: text("error"),

    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("idx_automation_runs_automation").on(t.automationId),
    index("idx_automation_runs_status").on(t.status),
    index("idx_automation_runs_started").on(t.startedAt),
    check(
      "check_automation_runs_result_json",
      sql`json_valid(${t.result}) OR ${t.result} IS NULL`,
    ),
  ],
);

/* -----------------------------
   PULSES (scheduled work runs)
------------------------------ */

export const pulses = sqliteTable(
  "pulses",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    // Developer pulses run in a workspace; work/chat pulses run workspace-less
    // (managed execution dir) and may target a collection instead.
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),

    collectionId: text("collection_id").references(() => collections.id, {
      onDelete: "set null",
    }),

    // Experience mode the pulse's runs execute under (see shared/modes.ts).
    mode: text("mode", { enum: MODE_IDS }).notNull().default(DEFAULT_MODE_ID),

    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),

    model: text("model").notNull(),

    title: text("title").notNull(),
    prompt: text("prompt").notNull(),

    frequency: text("frequency", {
      enum: ["hourly", "daily", "weekdays", "weekly"],
    }).notNull(),

    dayOfWeek: integer("day_of_week"), // 0=Sun..6=Sat, only for weekly
    hour: integer("hour").notNull().default(9), // 0-23, ignored for hourly
    minute: integer("minute").notNull().default(0), // 0-59
    timezone: text("timezone").notNull(),

    thinkingMode: integer("thinking_mode", { mode: "boolean" })
      .notNull()
      .default(false),
    effortLevel: text("effort_level"), // "" | minimal | low | medium | high | max | xhigh

    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),

    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }),
    lastRunId: text("last_run_id").references(() => runs.id, {
      onDelete: "set null",
    }),
    lastError: text("last_error"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_pulses_account").on(t.accountId),
    index("idx_pulses_workspace").on(t.workspaceId),
    index("idx_pulses_active_next_run").on(t.isActive, t.nextRunAt),
    check(
      "check_pulses_frequency_dow",
      sql`(${t.frequency} = 'weekly' AND ${t.dayOfWeek} BETWEEN 0 AND 6) OR (${t.frequency} <> 'weekly' AND ${t.dayOfWeek} IS NULL)`,
    ),
    check("check_pulses_hour", sql`${t.hour} BETWEEN 0 AND 23`),
    check("check_pulses_minute", sql`${t.minute} BETWEEN 0 AND 59`),
  ],
);
