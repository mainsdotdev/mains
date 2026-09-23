PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`workspaces_path` text,
	`branches` text,
	`remote_origin` text,
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
	CONSTRAINT "check_projects_branches_json" CHECK(json_valid("__new_projects"."branches") OR "__new_projects"."branches" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "account_id", "name", "root_path", "workspaces_path", "branches", "remote_origin", "default_branch", "setup_script", "run_script", "archive_script", "icon", "commit_instructions", "pr_instructions", "is_archived", "created_at", "updated_at") SELECT "id", "account_id", "name", "root_path", "workspaces_path", "branches", "remote_origin", "default_branch", "setup_script", "run_script", "archive_script", "icon", "commit_instructions", "pr_instructions", "is_archived", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_projects_account_origin` ON `projects` (`account_id`,`remote_origin`) WHERE "projects"."remote_origin" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_projects_account_root` ON `projects` (`account_id`,`root_path`) WHERE "projects"."remote_origin" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_projects_account` ON `projects` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_remote_origin` ON `projects` (`remote_origin`);--> statement-breakpoint
CREATE INDEX `idx_projects_updated` ON `projects` (`updated_at`);