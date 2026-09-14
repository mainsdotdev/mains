CREATE TABLE `collection_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_collection_sources_kind" CHECK("collection_sources"."kind" IN ('file', 'text')),
	CONSTRAINT "check_collection_sources_byte_size" CHECK("collection_sources"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_collection_sources_collection` ON `collection_sources` (`collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_collection_sources_content` ON `collection_sources` (`collection_id`,`content_hash`);--> statement-breakpoint
UPDATE `workspaces`
SET `project_id` = (
	SELECT `projects`.`id`
	FROM `projects`
	WHERE `projects`.`account_id` = `workspaces`.`account_id`
		AND `projects`.`root_path` = `workspaces`.`root_path`
	LIMIT 1
)
WHERE `project_id` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `projects`
		WHERE `projects`.`account_id` = `workspaces`.`account_id`
			AND `projects`.`root_path` = `workspaces`.`root_path`
	);--> statement-breakpoint
INSERT INTO `projects` (
	`id`, `account_id`, `name`, `root_path`, `remote_origin`,
	`default_branch`, `created_at`, `updated_at`
)
SELECT
	'legacy-' || lower(hex(randomblob(16))),
	`account_id`,
	`name`,
	`root_path`,
	NULL,
	`base_branch`,
	`created_at`,
	`updated_at`
FROM `workspaces`
WHERE `project_id` IS NULL;--> statement-breakpoint
UPDATE `workspaces`
SET `project_id` = (
	SELECT `projects`.`id`
	FROM `projects`
	WHERE `projects`.`account_id` = `workspaces`.`account_id`
		AND `projects`.`root_path` = `workspaces`.`root_path`
	LIMIT 1
)
WHERE `project_id` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`repo_url` text,
	`base_branch` text,
	`metadata` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_workspaces_metadata_json" CHECK(json_valid("__new_workspaces"."metadata") OR "__new_workspaces"."metadata" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "account_id", "project_id", "name", "root_path", "repo_url", "base_branch", "metadata", "status", "is_archived", "created_at", "updated_at") SELECT "id", "account_id", "project_id", "name", "root_path", "repo_url", "base_branch", "metadata", "status", "is_archived", "created_at", "updated_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_workspaces_account` ON `workspaces` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_project` ON `workspaces` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspaces_account_root` ON `workspaces` (`account_id`,`root_path`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_status` ON `workspaces` (`status`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_updated` ON `workspaces` (`updated_at`);
