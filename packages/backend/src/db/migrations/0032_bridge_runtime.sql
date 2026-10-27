CREATE TABLE `bridge_peers` (
	`backend_id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`platform` text,
	`last_seen_ms` integer
);
--> statement-breakpoint
ALTER TABLE `bridge_config` ADD `account_fingerprint` text;