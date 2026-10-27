CREATE TABLE `provider_session_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`subpath` text DEFAULT '' NOT NULL,
	`seq` integer NOT NULL,
	`uuid` text,
	`entry` text,
	`byte_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_provider_session_entry_json" CHECK("provider_session_entries"."entry" IS NULL OR json_valid("provider_session_entries"."entry")),
	CONSTRAINT "check_provider_session_entry_size" CHECK("provider_session_entries"."byte_size" >= 0 AND "provider_session_entries"."seq" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_provider_session_entries_order` ON `provider_session_entries` (`run_id`,`session_id`,`subpath`,`seq`,`id`);--> statement-breakpoint
ALTER TABLE `bridge_row_clock` ADD `last_ack_ms` integer;