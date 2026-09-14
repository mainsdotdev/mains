CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_collections_mode" CHECK("collections"."mode" IN ('work', 'chat'))
);
--> statement-breakpoint
CREATE INDEX `idx_collections_account_mode` ON `collections` (`account_id`,`mode`);--> statement-breakpoint
CREATE INDEX `idx_collections_updated` ON `collections` (`updated_at`);--> statement-breakpoint
ALTER TABLE `runs` ADD `collection_id` text REFERENCES collections(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_runs_collection` ON `runs` (`collection_id`);
