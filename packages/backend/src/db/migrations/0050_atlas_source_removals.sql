CREATE TABLE `atlas_source_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`source_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content_hash` text,
	`trashed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_atlas_source_removals_kind" CHECK("atlas_source_removals"."kind" IN ('file', 'image'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_source_removals_source` ON `atlas_source_removals` (`account_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `idx_atlas_source_removals_hash` ON `atlas_source_removals` (`account_id`,`kind`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_atlas_source_removals_trash` ON `atlas_source_removals` (`account_id`,`trashed_at`);