CREATE TABLE `atlas_item_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`is_excluded` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `atlas_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `atlas_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_atlas_item_tags_source" CHECK("atlas_item_tags"."source" IN ('user', 'ai'))
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_item_tags_tag` ON `atlas_item_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `atlas_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_tags_name` ON `atlas_tags` (`account_id`,`normalized_name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA legacy_alter_table=ON;--> statement-breakpoint
CREATE TABLE `__new_atlas_items` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`metadata` text,
	`url` text,
	`normalized_url` text,
	`description` text,
	`note` text,
	`bookmark_job` text,
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
	`current_revision_id` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`current_revision_id`) REFERENCES `atlas_page_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_atlas_items_kind" CHECK("kind" IN ('page', 'file', 'image', 'bookmark')),
	CONSTRAINT "check_atlas_items_metadata_json" CHECK(json_valid("metadata") OR "metadata" IS NULL),
	CONSTRAINT "check_atlas_items_bookmark_job_json" CHECK(json_valid("bookmark_job") OR "bookmark_job" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_atlas_items`("id", "account_id", "kind", "title", "metadata", "collection_id", "source_run_id", "source_key", "storage_key", "file_name", "mime_type", "byte_size", "content_hash", "is_favorite", "trashed_at", "current_revision_id", "version", "created_at", "updated_at") SELECT "id", "account_id", "kind", "title", "metadata", "collection_id", "source_run_id", "source_key", "storage_key", "file_name", "mime_type", "byte_size", "content_hash", "is_favorite", "trashed_at", "current_revision_id", "version", "created_at", "updated_at" FROM `atlas_items`;--> statement-breakpoint
DROP TABLE `atlas_items`;--> statement-breakpoint
ALTER TABLE `__new_atlas_items` RENAME TO `atlas_items`;--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_atlas_items_account_updated` ON `atlas_items` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_atlas_items_collection` ON `atlas_items` (`collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_items_source` ON `atlas_items` (`account_id`,`source_key`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `atlas_auto_tagging` text;
--> statement-breakpoint
CREATE TEMP TABLE __atlas_fk_check (violations integer CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO __atlas_fk_check SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE __atlas_fk_check;
