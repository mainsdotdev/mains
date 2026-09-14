CREATE TABLE `accounts` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`display_name` text,
	`email` text,
	`company` text,
	`job_title` text,
	`timezone` text,
	`locale` text,
	`website` text,
	`avatar_url` text,
	`bio` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_email` ON `accounts` (`email`);--> statement-breakpoint
CREATE INDEX `idx_accounts_display_name` ON `accounts` (`display_name`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`account_id` text NOT NULL,
	`active_space_id` text,
	`enable_worktrees` integer DEFAULT true NOT NULL,
	`show_tool_calls` integer DEFAULT true NOT NULL,
	`prevent_sleep_during_runs` integer DEFAULT false NOT NULL,
	`notify_on_run_complete` integer DEFAULT true NOT NULL,
	`notify_on_tool_approval` integer DEFAULT true NOT NULL,
	`commit_instructions` text DEFAULT '' NOT NULL,
	`pr_instructions` text DEFAULT '' NOT NULL,
	`seed_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`duration_ms` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_automation_runs_result_json" CHECK(json_valid("automation_runs"."result") OR "automation_runs"."result" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation` ON `automation_runs` (`automation_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_status` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_started` ON `automation_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`action` text NOT NULL,
	`interval_minutes` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`config` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`last_error` text,
	`consecutive_errors` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_automations_config_json" CHECK(json_valid("automations"."config") OR "automations"."config" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_automations_account` ON `automations` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_automations_kind` ON `automations` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_automations_active` ON `automations` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_automations_next_run` ON `automations` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `connection_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`url` text,
	`selected` integer DEFAULT true NOT NULL,
	`metadata` text,
	`last_seen_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_resources_metadata_json" CHECK(json_valid("connection_resources"."metadata") OR "connection_resources"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_resources_conn_ext` ON `connection_resources` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_resources_kind` ON `connection_resources` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_resources_selected` ON `connection_resources` (`selected`);--> statement-breakpoint
CREATE INDEX `idx_resources_conn` ON `connection_resources` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_resources_last_seen` ON `connection_resources` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `connection_states` (
	`id` text PRIMARY KEY NOT NULL,
	`is_connected` integer DEFAULT false NOT NULL,
	`connection_id` text,
	`display_name` text,
	`category` text,
	`icon_path` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`enabled_features` text,
	`config` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_enabled_features_json" CHECK(json_valid("connection_states"."enabled_features") OR "connection_states"."enabled_features" IS NULL),
	CONSTRAINT "check_config_json" CHECK(json_valid("connection_states"."config") OR "connection_states"."config" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_connection_states_connected` ON `connection_states` (`is_connected`);--> statement-breakpoint
CREATE INDEX `idx_connection_states_sort` ON `connection_states` (`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_connection_states_updated_at` ON `connection_states` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_connection_states_created_at` ON `connection_states` (`created_at`);--> statement-breakpoint
CREATE TABLE `connection_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` text NOT NULL,
	`access_token_enc` blob,
	`refresh_token_enc` blob,
	`token_type` text,
	`expires_at` integer,
	`token_hash` blob,
	`key_version` integer DEFAULT 1 NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ct_conn` ON `connection_tokens` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_ct_current` ON `connection_tokens` (`is_current`);--> statement-breakpoint
CREATE INDEX `idx_ct_expires` ON `connection_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_ct_created_at` ON `connection_tokens` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ct_token_hash` ON `connection_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_ct_conn_current` ON `connection_tokens` (`connection_id`) WHERE "connection_tokens"."is_current" = 1;--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`display_name` text,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`scopes` text,
	`metadata` text,
	`connected_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "check_connections_metadata_json" CHECK(json_valid("connections"."metadata") OR "connections"."metadata" IS NULL),
	CONSTRAINT "check_connections_scopes_json" CHECK(json_valid("connections"."scopes") OR "connections"."scopes" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_connections_provider` ON `connections` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_connections_status` ON `connections` (`status`);--> statement-breakpoint
CREATE INDEX `idx_connections_connected_at` ON `connections` (`connected_at`);--> statement-breakpoint
CREATE INDEX `idx_connections_updated_at` ON `connections` (`updated_at`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`connection_id` text,
	`resource_id` text,
	`external_id` text,
	`url` text,
	`title` text,
	`body` text,
	`summary` text,
	`metadata` text,
	`occurred_at` integer,
	`source_updated_at` integer,
	`etag` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resource_id`) REFERENCES `connection_resources`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_entities_metadata_json" CHECK(json_valid("entities"."metadata") OR "entities"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_entities_source` ON `entities` (`connection_id`,`kind`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_entities_account_kind` ON `entities` (`account_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_entities_conn` ON `entities` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_entities_resource` ON `entities` (`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_entities_occurred` ON `entities` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_entities_updated` ON `entities` (`updated_at`);--> statement-breakpoint
CREATE TABLE `issues` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`state` text NOT NULL,
	`number` integer,
	`repo` text,
	`assignee` text,
	`labels` text,
	`closed_at` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_issues_labels_json" CHECK(json_valid("issues"."labels") OR "issues"."labels" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_issues_provider_state` ON `issues` (`provider`,`state`);--> statement-breakpoint
CREATE INDEX `idx_issues_repo` ON `issues` (`repo`);--> statement-breakpoint
CREATE TABLE `project_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `connection_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_project_resources` ON `project_resources` (`project_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_project_resources_project` ON `project_resources` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_resources_resource` ON `project_resources` (`resource_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`workspaces_path` text,
	`branches` text,
	`remote_origin` text NOT NULL,
	`default_branch` text,
	`setup_script` text,
	`run_script` text,
	`archive_script` text,
	`icon` text,
	`commit_instructions` text,
	`pr_instructions` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_projects_branches_json" CHECK(json_valid("projects"."branches") OR "projects"."branches" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_projects_account_origin` ON `projects` (`account_id`,`remote_origin`);--> statement-breakpoint
CREATE INDEX `idx_projects_account` ON `projects` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_remote_origin` ON `projects` (`remote_origin`);--> statement-breakpoint
CREATE INDEX `idx_projects_updated` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`config` text,
	`capabilities` text,
	`default_model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "check_providers_config_json" CHECK(json_valid("providers"."config") OR "providers"."config" IS NULL),
	CONSTRAINT "check_providers_capabilities_json" CHECK(json_valid("providers"."capabilities") OR "providers"."capabilities" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_providers_kind` ON `providers` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_providers_enabled` ON `providers` (`is_enabled`);--> statement-breakpoint
CREATE INDEX `idx_providers_updated` ON `providers` (`updated_at`);--> statement-breakpoint
CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`severity` text NOT NULL,
	`file` text NOT NULL,
	`line_start` integer,
	`line_end` integer,
	`message` text NOT NULL,
	`reason` text NOT NULL,
	`suggestion` text,
	`validated` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_review_findings_metadata_json" CHECK(json_valid("review_findings"."metadata") OR "review_findings"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_review_findings_review` ON `review_findings` (`review_id`);--> statement-breakpoint
CREATE INDEX `idx_review_findings_severity` ON `review_findings` (`severity`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`summary` text,
	`status` text DEFAULT 'open' NOT NULL,
	`run_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_reviews_metadata_json" CHECK(json_valid("reviews"."metadata") OR "reviews"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_workspace` ON `reviews` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_status` ON `reviews` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reviews_updated` ON `reviews` (`updated_at`);--> statement-breakpoint
CREATE TABLE `run_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text,
	`content` text,
	`blob_data` blob,
	`entity_id` text,
	`content_hash` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_run_artifacts_metadata_json" CHECK(json_valid("run_artifacts"."metadata") OR "run_artifacts"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_run_artifacts_run` ON `run_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_run_artifacts_kind` ON `run_artifacts` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_run_artifacts_path` ON `run_artifacts` (`path`);--> statement-breakpoint
CREATE INDEX `idx_run_artifacts_entity` ON `run_artifacts` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_run_artifacts_hash` ON `run_artifacts` (`content_hash`);--> statement-breakpoint
CREATE TABLE `run_context` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`content` text,
	`entity_id` text,
	`content_hash` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_run_context_metadata_json" CHECK(json_valid("run_context"."metadata") OR "run_context"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_run_context_run` ON `run_context` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_run_context_kind` ON `run_context` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_run_context_entity` ON `run_context` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_run_context_hash` ON `run_context` (`content_hash`);--> statement-breakpoint
CREATE TABLE `run_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`prompt_content` text,
	`response_content` text,
	`started_at` integer,
	`ended_at` integer,
	`elapsed_ms` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`cost_micros` integer,
	`model` text,
	`model_usage` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_run_turns_metadata_json" CHECK(json_valid("run_turns"."metadata") OR "run_turns"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_run_turns_run` ON `run_turns` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_run_turns_run_index` ON `run_turns` (`run_id`,`turn_index`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`workspace_id` text,
	`space_id` text,
	`provider_id` text NOT NULL,
	`model` text,
	`title` text,
	`goal` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`system_prompt` text,
	`config_snapshot` text,
	`tool_policy_snapshot` text,
	`started_at` integer,
	`ended_at` integer,
	`last_error` text,
	`stop_reason` text,
	`session_id` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_runs_config_snapshot_json" CHECK(json_valid("runs"."config_snapshot") OR "runs"."config_snapshot" IS NULL),
	CONSTRAINT "check_runs_tool_policy_snapshot_json" CHECK(json_valid("runs"."tool_policy_snapshot") OR "runs"."tool_policy_snapshot" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_runs_account_created` ON `runs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_account_status` ON `runs` (`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_runs_provider` ON `runs` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_workspace` ON `runs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_space` ON `runs` (`space_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_updated` ON `runs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `signals` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`level` text DEFAULT 'error' NOT NULL,
	`category` text DEFAULT 'bug' NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`event_count` integer DEFAULT 1 NOT NULL,
	`affected_users` integer,
	`first_seen_at` integer,
	`last_seen_at` integer,
	`stack_trace` text,
	`file` text,
	`function` text,
	`line` integer,
	`assignee` text,
	`labels` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`project_id` text,
	`resolved_at` integer,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_signals_labels_json" CHECK(json_valid("signals"."labels") OR "signals"."labels" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_signals_source` ON `signals` (`source`);--> statement-breakpoint
CREATE INDEX `idx_signals_level` ON `signals` (`level`);--> statement-breakpoint
CREATE INDEX `idx_signals_category` ON `signals` (`category`);--> statement-breakpoint
CREATE INDEX `idx_signals_state` ON `signals` (`state`);--> statement-breakpoint
CREATE INDEX `idx_signals_project` ON `signals` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_signals_last_seen` ON `signals` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`system_prompt` text,
	`model` text,
	`icon` text,
	`theme_config` text,
	`ui_config` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_spaces_theme_json" CHECK(json_valid("spaces"."theme_config") OR "spaces"."theme_config" IS NULL),
	CONSTRAINT "check_spaces_ui_json" CHECK(json_valid("spaces"."ui_config") OR "spaces"."ui_config" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_spaces_account_slug` ON `spaces` (`account_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_spaces_account_name` ON `spaces` (`account_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_spaces_account` ON `spaces` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_spaces_sort` ON `spaces` (`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_spaces_updated` ON `spaces` (`updated_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_at` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`labels` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_tasks_labels_json" CHECK(json_valid("tasks"."labels") OR "tasks"."labels" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due` ON `tasks` (`due_at`);--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`run_id` text,
	`provider_id` text,
	`tool_call_id` text,
	`parent_tool_call_id` text,
	`tool_name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input` text,
	`output` text,
	`error` text,
	`started_at` integer,
	`ended_at` integer,
	`latency_ms` integer,
	`cost_micros` integer,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_tool_calls_input_json" CHECK(json_valid("tool_calls"."input") OR "tool_calls"."input" IS NULL),
	CONSTRAINT "check_tool_calls_output_json" CHECK(json_valid("tool_calls"."output") OR "tool_calls"."output" IS NULL),
	CONSTRAINT "check_tool_calls_metadata_json" CHECK(json_valid("tool_calls"."metadata") OR "tool_calls"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_tool_calls_account_created` ON `tool_calls` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_run` ON `tool_calls` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_provider` ON `tool_calls` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_status` ON `tool_calls` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_run_toolcallid` ON `tool_calls` (`run_id`,`tool_call_id`);--> statement-breakpoint
CREATE TABLE `workspace_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`metadata` text,
	`ref_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_workspace_activity_metadata_json" CHECK(json_valid("workspace_activity"."metadata") OR "workspace_activity"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_activity_workspace` ON `workspace_activity` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_activity_type` ON `workspace_activity` (`type`);--> statement-breakpoint
CREATE INDEX `idx_workspace_activity_created` ON `workspace_activity` (`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_diffs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text,
	`base_ref` text,
	`diff_text` text NOT NULL,
	`files_json` text,
	`stats_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_workspace_diffs_files_json" CHECK(json_valid("workspace_diffs"."files_json") OR "workspace_diffs"."files_json" IS NULL),
	CONSTRAINT "check_workspace_diffs_stats_json" CHECK(json_valid("workspace_diffs"."stats_json") OR "workspace_diffs"."stats_json" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_diffs_workspace` ON `workspace_diffs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_diffs_created` ON `workspace_diffs` (`created_at`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`repo_url` text,
	`default_branch` text,
	`metadata` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_workspaces_metadata_json" CHECK(json_valid("workspaces"."metadata") OR "workspaces"."metadata" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_workspaces_account` ON `workspaces` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_project` ON `workspaces` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspaces_account_root` ON `workspaces` (`account_id`,`root_path`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_status` ON `workspaces` (`status`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_updated` ON `workspaces` (`updated_at`);