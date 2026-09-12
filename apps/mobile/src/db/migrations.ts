/**
 * Ordered, append-only migrations. Index N brings the database from
 * `user_version` N to N+1. Never edit a shipped entry — add the next one.
 * Hand-written on purpose: the schema is small and phone-owned, and this
 * avoids a drizzle-kit/Metro `.sql` bundling setup for now.
 */
export const MIGRATIONS: readonly string[] = [
  // v1 — backends, workspaces, runs, run_turns, tool_calls, sync_cursors
  `
  CREATE TABLE backends (
    backend_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    app_version TEXT,
    protocol_version INTEGER,
    last_synced_at INTEGER
  );
  CREATE TABLE workspaces (
    backend_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    project_id TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, id)
  );
  CREATE TABLE runs (
    backend_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT,
    workspace_id TEXT,
    collection_id TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    last_error TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (backend_id, id)
  );
  CREATE INDEX idx_runs_backend_updated ON runs (backend_id, updated_at);
  CREATE TABLE run_turns (
    backend_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    prompt_content TEXT,
    response_content TEXT,
    status TEXT NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    elapsed_ms INTEGER,
    model TEXT,
    PRIMARY KEY (backend_id, run_id, turn_index)
  );
  CREATE TABLE tool_calls (
    backend_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    id INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    error TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (backend_id, run_id, id)
  );
  CREATE INDEX idx_tool_calls_run ON tool_calls (backend_id, run_id, created_at);
  CREATE TABLE sync_cursors (
    backend_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tool_updated_at INTEGER,
    full_synced_at INTEGER,
    PRIMARY KEY (backend_id, run_id)
  );
  `,
  // v2 — run_artifacts (the transcript's real source) + artifact cursor
  `
  CREATE TABLE run_artifacts (
    backend_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    content TEXT,
    path TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (backend_id, run_id, id)
  );
  CREATE INDEX idx_run_artifacts_run ON run_artifacts (backend_id, run_id, created_at);
  ALTER TABLE sync_cursors ADD COLUMN artifact_id INTEGER;
  `,
  // v3 — pending_approvals (agent requests waiting on the user)
  `
  CREATE TABLE pending_approvals (
    backend_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    header TEXT,
    question TEXT,
    options_json TEXT,
    multi_select INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    tool_input_json TEXT,
    requested_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (backend_id, request_id)
  );
  CREATE INDEX idx_pending_approvals_run ON pending_approvals (backend_id, run_id);
  `,
  // v4 — answer UI fields on pending_approvals
  `
  ALTER TABLE pending_approvals ADD COLUMN is_other INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE pending_approvals ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE pending_approvals ADD COLUMN elicitation_mode TEXT;
  ALTER TABLE pending_approvals ADD COLUMN url TEXT;
  `,
  // v5 — run targets: spaces, collections, providers, remembered targets
  `
  CREATE TABLE spaces (
    backend_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    provider_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT,
    sort_order INTEGER,
    is_archived INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, id)
  );
  CREATE TABLE collections (
    backend_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, id)
  );
  CREATE TABLE providers (
    backend_id TEXT NOT NULL,
    id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (backend_id, id)
  );
  CREATE TABLE space_targets (
    backend_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    workspace_id TEXT,
    collection_id TEXT,
    PRIMARY KEY (backend_id, space_id)
  );
  ALTER TABLE backends ADD COLUMN last_space_id TEXT;
  `,
  // v6 — the composer's model picker: models per provider, effort, the phone's choice
  `
  ALTER TABLE providers ADD COLUMN effort_level TEXT;
  ALTER TABLE providers ADD COLUMN thinking_mode INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE models (
    backend_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    effort_levels TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, provider_id, id)
  );
  CREATE TABLE model_choices (
    backend_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    PRIMARY KEY (backend_id, provider_id)
  );
  `,
  // v7 — the rest of the composer toolbar: permission mode, fast / goal / plan
  `
  ALTER TABLE providers ADD COLUMN permission_mode TEXT;
  ALTER TABLE providers ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE providers ADD COLUMN goal_mode INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE providers ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE models ADD COLUMN supports_fast_mode INTEGER NOT NULL DEFAULT 0;
  `,
  // v8 — the Code sidebar: projects, workspace status and recency
  `
  CREATE TABLE projects (
    backend_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, id)
  );
  ALTER TABLE workspaces ADD COLUMN status TEXT;
  ALTER TABLE workspaces ADD COLUMN updated_at INTEGER;
  `,
  // v9 — workspace rows: branch, folder presence, last diff size
  `
  ALTER TABLE workspaces ADD COLUMN branch TEXT;
  ALTER TABLE workspaces ADD COLUMN path_exists INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE workspaces ADD COLUMN diff_additions INTEGER;
  ALTER TABLE workspaces ADD COLUMN diff_deletions INTEGER;
  `,
  // v10 — the composer's context picker: what a provider offers behind @ / $ / /
  `
  CREATE TABLE skills (
    backend_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT,
    description TEXT,
    short_description TEXT,
    argument_hint TEXT,
    icon_small TEXT,
    icon_large TEXT,
    brand_color TEXT,
    scope TEXT,
    path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, provider_id, name)
  );
  CREATE TABLE commands (
    backend_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    argument_hint TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (backend_id, provider_id, name)
  );
  `,
  // v11 — a workspace's path on the Mac: skills and commands are listed against it
  `
  ALTER TABLE workspaces ADD COLUMN root_path TEXT;
  `,
  // v12 — explicit third-party AI data-sharing permission, local to this phone
  `
  CREATE TABLE ai_data_consents (
    backend_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    disclosure_version INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL,
    PRIMARY KEY (backend_id, provider_id)
  );
  `,
  // v13 — subagent identity, parent linkage and lifecycle metadata on tool calls
  `
  ALTER TABLE tool_calls ADD COLUMN tool_id TEXT;
  ALTER TABLE tool_calls ADD COLUMN parent_tool_call_id TEXT;
  ALTER TABLE tool_calls ADD COLUMN metadata_json TEXT;
  CREATE INDEX idx_tool_calls_parent ON tool_calls (backend_id, run_id, parent_tool_call_id);
  UPDATE sync_cursors SET tool_updated_at = NULL;
  `,
  // v14 — this phone's own settings (appearance), never written by sync
  `
  CREATE TABLE preferences (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
];
