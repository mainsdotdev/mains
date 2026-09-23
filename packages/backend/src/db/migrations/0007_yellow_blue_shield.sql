PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`system_prompt` text,
	`model` text,
	`icon` text,
	`theme_config` text,
	`provider_id` text DEFAULT 'claude_code' NOT NULL,
	`mode` text DEFAULT 'developer' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_spaces_theme_json" CHECK(json_valid("__new_spaces"."theme_config") OR "__new_spaces"."theme_config" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_spaces`("id", "account_id", "name", "slug", "description", "system_prompt", "model", "icon", "theme_config", "provider_id", "mode", "is_archived", "sort_order", "created_at", "updated_at") SELECT "id", "account_id", "name", "slug", "description", "system_prompt", "model", "icon", "theme_config", COALESCE(json_extract("ui_config", '$.providerId'), 'claude_code'), 'developer', "is_archived", "sort_order", "created_at", "updated_at" FROM `spaces`;--> statement-breakpoint
DROP TABLE `spaces`;--> statement-breakpoint
ALTER TABLE `__new_spaces` RENAME TO `spaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_spaces_account_slug` ON `spaces` (`account_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_spaces_account_name` ON `spaces` (`account_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_spaces_account` ON `spaces` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_spaces_sort` ON `spaces` (`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_spaces_updated` ON `spaces` (`updated_at`);