CREATE TABLE `pulses` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`workspace_id` text NOT NULL,
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
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_pulses_frequency_dow" CHECK(("pulses"."frequency" = 'weekly' AND "pulses"."day_of_week" BETWEEN 0 AND 6) OR ("pulses"."frequency" <> 'weekly' AND "pulses"."day_of_week" IS NULL)),
	CONSTRAINT "check_pulses_hour" CHECK("pulses"."hour" BETWEEN 0 AND 23),
	CONSTRAINT "check_pulses_minute" CHECK("pulses"."minute" BETWEEN 0 AND 59)
);
--> statement-breakpoint
CREATE INDEX `idx_pulses_account` ON `pulses` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_pulses_workspace` ON `pulses` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_pulses_active_next_run` ON `pulses` (`is_active`,`next_run_at`);