CREATE TABLE `assistant_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`team_id` text NOT NULL,
	`from_assistant_id` text,
	`to_assistant_id` text NOT NULL,
	`from_run_id` text,
	`parent_id` text,
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
	CONSTRAINT "check_assistant_evidence_json" CHECK(json_valid("assistant_assignments"."evidence"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assistant_assignments_key` ON `assistant_assignments` (`account_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_assistant_assignments_team` ON `assistant_assignments` (`team_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`team_id` text NOT NULL,
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
	FOREIGN KEY (`assistant_id`) REFERENCES `assistants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_memories_scope` ON `assistant_memories` (`account_id`,`team_id`,`assistant_id`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_run_id` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assistant_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_messages_pending` ON `assistant_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_teams_account` ON `assistant_teams` (`account_id`);--> statement-breakpoint
CREATE TABLE `assistants` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text NOT NULL,
	`space_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`mode` text NOT NULL,
	`model` text NOT NULL,
	`effort` text NOT NULL,
	`settings` text NOT NULL,
	`space_snapshot` text NOT NULL,
	`workspace_id` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `assistant_teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_assistants_settings_json" CHECK(json_valid("assistants"."settings")),
	CONSTRAINT "check_assistants_space_json" CHECK(json_valid("assistants"."space_snapshot"))
);
--> statement-breakpoint
CREATE INDEX `idx_assistants_account_team` ON `assistants` (`account_id`,`team_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `assistant_id` text;