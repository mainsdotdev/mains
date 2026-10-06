CREATE TABLE `atlas_items` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`collection_id` text,
	`source_run_id` text,
	`source_key` text,
	`storage_key` text,
	`file_name` text,
	`mime_type` text,
	`byte_size` integer,
	`content_hash` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	`trashed_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_atlas_items_kind" CHECK("atlas_items"."kind" IN ('page', 'file', 'image'))
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_items_account_updated` ON `atlas_items` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_atlas_items_collection` ON `atlas_items` (`collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_items_source` ON `atlas_items` (`account_id`,`source_key`);--> statement-breakpoint
CREATE TABLE `atlas_page_file_refs` (
	`revision_id` text NOT NULL,
	`file_id` text NOT NULL,
	PRIMARY KEY(`revision_id`, `file_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `atlas_page_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `atlas_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_page_file_refs_file` ON `atlas_page_file_refs` (`file_id`);--> statement-breakpoint
CREATE TABLE `atlas_page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`version` integer NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`blocks_json` text NOT NULL,
	`markdown` text NOT NULL,
	`actor` text NOT NULL,
	`source_run_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `atlas_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_atlas_page_revisions_blocks_json" CHECK(json_valid("atlas_page_revisions"."blocks_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_page_revisions_version` ON `atlas_page_revisions` (`item_id`,`version`);