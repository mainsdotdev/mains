CREATE TABLE `paired_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT 'unknown' NOT NULL,
	`app_version` text,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_paired_devices_token_hash` ON `paired_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_paired_devices_revoked_at` ON `paired_devices` (`revoked_at`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backend_id` text;