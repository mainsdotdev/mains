PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pulses` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`workspace_id` text,
	`collection_id` text,
	`mode` text DEFAULT 'developer' NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`frequency` text NOT NULL,
	`day_of_week` integer,
	`hour` integer DEFAULT 9 NOT NULL,
	`minute` integer DEFAULT 0 NOT NULL,
	`timezone` text NOT NULL,
	`thinking_mode` integer DEFAULT false NOT NULL,
	`effort_level` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`last_run_id` text,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_pulses_frequency_dow" CHECK(("__new_pulses"."frequency" = 'weekly' AND "__new_pulses"."day_of_week" BETWEEN 0 AND 6) OR ("__new_pulses"."frequency" <> 'weekly' AND "__new_pulses"."day_of_week" IS NULL)),
	CONSTRAINT "check_pulses_hour" CHECK("__new_pulses"."hour" BETWEEN 0 AND 23),
	CONSTRAINT "check_pulses_minute" CHECK("__new_pulses"."minute" BETWEEN 0 AND 59)
);
--> statement-breakpoint
INSERT INTO `__new_pulses`("id", "account_id", "workspace_id", "collection_id", "mode", "provider_id", "model", "title", "prompt", "frequency", "day_of_week", "hour", "minute", "timezone", "thinking_mode", "effort_level", "is_active", "last_run_at", "next_run_at", "last_run_id", "last_error", "created_at", "updated_at") SELECT "id", "account_id", "workspace_id", NULL, 'developer', "provider_id", "model", "title", "prompt", "frequency", "day_of_week", "hour", "minute", "timezone", "thinking_mode", "effort_level", "is_active", "last_run_at", "next_run_at", "last_run_id", "last_error", "created_at", "updated_at" FROM `pulses`;--> statement-breakpoint
DROP TABLE `pulses`;--> statement-breakpoint
ALTER TABLE `__new_pulses` RENAME TO `pulses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_pulses_account` ON `pulses` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_pulses_workspace` ON `pulses` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_pulses_active_next_run` ON `pulses` (`is_active`,`next_run_at`);