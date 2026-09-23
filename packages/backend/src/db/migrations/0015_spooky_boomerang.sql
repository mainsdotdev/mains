PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`account_id` text NOT NULL,
	`active_space_id` text,
	`enable_worktrees` integer DEFAULT false NOT NULL,
	`show_tool_calls` integer DEFAULT true NOT NULL,
	`prevent_sleep_during_runs` integer DEFAULT false NOT NULL,
	`notify_on_run_complete` integer DEFAULT true NOT NULL,
	`notify_on_tool_approval` integer DEFAULT true NOT NULL,
	`show_menu_bar_icon` integer DEFAULT true NOT NULL,
	`backend_remote_access` integer DEFAULT false NOT NULL,
	`backend_lan_access` integer DEFAULT false NOT NULL,
	`backend_tailscale_https` integer DEFAULT false NOT NULL,
	`commit_instructions` text DEFAULT '' NOT NULL,
	`pr_instructions` text DEFAULT '' NOT NULL,
	`seed_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("id", "account_id", "active_space_id", "enable_worktrees", "show_tool_calls", "prevent_sleep_during_runs", "notify_on_run_complete", "notify_on_tool_approval", "show_menu_bar_icon", "backend_remote_access", "backend_lan_access", "backend_tailscale_https", "commit_instructions", "pr_instructions", "seed_version", "created_at", "updated_at") SELECT "id", "account_id", "active_space_id", "enable_worktrees", "show_tool_calls", "prevent_sleep_during_runs", "notify_on_run_complete", "notify_on_tool_approval", "show_menu_bar_icon", "backend_remote_access", "backend_lan_access", "backend_tailscale_https", "commit_instructions", "pr_instructions", "seed_version", "created_at", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;