PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_diffs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text,
	`base_ref` text,
	`diff_text` text NOT NULL,
	`files_json` text,
	`stats_json` text,
	`untracked_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_workspace_diffs_files_json" CHECK(json_valid("__new_workspace_diffs"."files_json") OR "__new_workspace_diffs"."files_json" IS NULL),
	CONSTRAINT "check_workspace_diffs_stats_json" CHECK(json_valid("__new_workspace_diffs"."stats_json") OR "__new_workspace_diffs"."stats_json" IS NULL),
	CONSTRAINT "check_workspace_diffs_untracked_json" CHECK(json_valid("__new_workspace_diffs"."untracked_json") OR "__new_workspace_diffs"."untracked_json" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_workspace_diffs`("id", "workspace_id", "run_id", "base_ref", "diff_text", "files_json", "stats_json", "untracked_json", "created_at") SELECT "id", "workspace_id", "run_id", "base_ref", "diff_text", "files_json", "stats_json", NULL, "created_at" FROM `workspace_diffs`;--> statement-breakpoint
DROP TABLE `workspace_diffs`;--> statement-breakpoint
ALTER TABLE `__new_workspace_diffs` RENAME TO `workspace_diffs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_workspace_diffs_workspace` ON `workspace_diffs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_diffs_created` ON `workspace_diffs` (`created_at`);