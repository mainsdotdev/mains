-- The production migrator suspends foreign keys before beginning its transaction.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assistant_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`team_id` text,
	`from_assistant_id` text,
	`to_assistant_id` text NOT NULL,
	`from_run_id` text,
	`parent_id` text,
	`execution` text DEFAULT '{"mode":"work"}' NOT NULL,
	`source_prompt_id` text,
	`source_context_id` integer,
	`context` text DEFAULT '{}' NOT NULL,
	`task_key` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`worker_run_id` text,
	`result` text,
	`evidence` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `assistant_teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_assistant_id`) REFERENCES `assistants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_assistant_id`) REFERENCES `assistants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "check_assistant_execution_json" CHECK(json_valid("__new_assistant_assignments"."execution")),
	CONSTRAINT "check_assistant_task_context_json" CHECK(json_valid("__new_assistant_assignments"."context")),
	CONSTRAINT "check_assistant_evidence_json" CHECK(json_valid("__new_assistant_assignments"."evidence"))
);
--> statement-breakpoint
INSERT INTO `__new_assistant_assignments`("id", "account_id", "team_id", "from_assistant_id", "to_assistant_id", "from_run_id", "parent_id", "execution", "source_prompt_id", "source_context_id", "context", "task_key", "dedupe_key", "title", "prompt", "status", "worker_run_id", "result", "evidence", "error", "created_at", "updated_at") SELECT "id", "account_id", "team_id", "from_assistant_id", "to_assistant_id", "from_run_id", "parent_id", "execution", "source_prompt_id", "source_context_id", "context", "task_key", "dedupe_key", "title", "prompt", "status", "worker_run_id", "result", "evidence", "error", "created_at", "updated_at" FROM `assistant_assignments`;--> statement-breakpoint
DROP TABLE `assistant_assignments`;--> statement-breakpoint
ALTER TABLE `__new_assistant_assignments` RENAME TO `assistant_assignments`;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assistant_assignments_context` ON `assistant_assignments` (`source_context_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assistant_assignments_key` ON `assistant_assignments` (`account_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_assistant_assignments_team` ON `assistant_assignments` (`team_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_assistant_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`team_id` text,
	`assistant_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_run_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `assistant_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_assistant_memory_owner" CHECK("__new_assistant_memories"."team_id" IS NOT NULL OR "__new_assistant_memories"."assistant_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_assistant_memories`("id", "account_id", "team_id", "assistant_id", "title", "content", "pinned", "revision", "source_run_id", "created_at", "updated_at") SELECT "id", "account_id", "team_id", "assistant_id", "title", "content", "pinned", "revision", "source_run_id", "created_at", "updated_at" FROM `assistant_memories`;--> statement-breakpoint
DROP TABLE `assistant_memories`;--> statement-breakpoint
ALTER TABLE `__new_assistant_memories` RENAME TO `assistant_memories`;--> statement-breakpoint
CREATE INDEX `idx_assistant_memories_scope` ON `assistant_memories` (`account_id`,`team_id`,`assistant_id`);--> statement-breakpoint
CREATE TABLE `__new_assistants` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`team_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text NOT NULL,
	`space_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`mode` text NOT NULL,
	`model` text NOT NULL,
	`effort` text NOT NULL,
	`avatar` text DEFAULT '{"shape":"circle","color":"blue"}' NOT NULL,
	`settings` text NOT NULL,
	`space_snapshot` text NOT NULL,
	`workspace_id` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `assistant_teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_assistants_avatar_json" CHECK(json_valid("__new_assistants"."avatar")),
	CONSTRAINT "check_assistants_settings_json" CHECK(json_valid("__new_assistants"."settings")),
	CONSTRAINT "check_assistants_space_json" CHECK(json_valid("__new_assistants"."space_snapshot"))
);
--> statement-breakpoint
INSERT INTO `__new_assistants`("id", "account_id", "team_id", "name", "description", "instructions", "space_id", "provider_id", "mode", "model", "effort", "avatar", "settings", "space_snapshot", "workspace_id", "is_archived", "created_at", "updated_at") SELECT "id", "account_id", "team_id", "name", "description", "instructions", "space_id", "provider_id", "mode", "model", "effort", "avatar", "settings", "space_snapshot", "workspace_id", "is_archived", "created_at", "updated_at" FROM `assistants`;--> statement-breakpoint
DROP TABLE `assistants`;--> statement-breakpoint
ALTER TABLE `__new_assistants` RENAME TO `assistants`;--> statement-breakpoint
CREATE INDEX `idx_assistants_account_team` ON `assistants` (`account_id`,`team_id`);--> statement-breakpoint
CREATE TEMP TABLE __assistant_fk_check (violations integer CHECK (violations = 0));--> statement-breakpoint
INSERT INTO __assistant_fk_check SELECT count(*) FROM pragma_foreign_key_check;--> statement-breakpoint
DROP TABLE __assistant_fk_check;--> statement-breakpoint
PRAGMA foreign_keys=ON;
