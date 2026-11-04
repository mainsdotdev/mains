CREATE TABLE `issue_status_mappings` (
	`resource_id` text NOT NULL,
	`state_id` text NOT NULL,
	`status_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`resource_id`, `state_id`),
	FOREIGN KEY (`resource_id`) REFERENCES `connection_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `issue_statuses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`fetcher_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`fetcher_id`, `resource_id`),
	FOREIGN KEY (`resource_id`) REFERENCES `connection_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `issues` ADD `state_id` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `status_id` text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE `issues` ADD `identifier` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `assignee_avatar_url` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `label_colors` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `group_name` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `group_color` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `due_at` integer;--> statement-breakpoint
CREATE INDEX `idx_issues_status` ON `issues` (`status_id`);--> statement-breakpoint
INSERT INTO `issue_statuses` (`id`, `name`, `category`, `sort_order`) VALUES
  ('backlog', 'Backlog', 'open', 0),
  ('todo', 'Todo', 'open', 1),
  ('in_progress', 'In progress', 'open', 2),
  ('in_review', 'In review', 'open', 3),
  ('done', 'Done', 'closed', 4),
  ('canceled', 'Canceled', 'closed', 5);--> statement-breakpoint
-- Best guess from the stored state names until the next sync writes the
-- provider's own category. sync_cursors starts empty, so that next sync is a
-- full one and also fills the new row fields on every issue already stored.
UPDATE `issues` SET `status_id` = CASE
  WHEN lower(`state`) IN ('canceled', 'cancelled', 'duplicate', 'wontfix', 'won''t fix') THEN 'canceled'
  WHEN `closed_at` IS NOT NULL OR lower(`state`) IN ('closed', 'completed', 'done', 'resolved') THEN 'done'
  WHEN lower(`state`) IN ('backlog', 'triage', 'icebox') THEN 'backlog'
  WHEN lower(`state`) LIKE '%review%' THEN 'in_review'
  WHEN lower(`state`) LIKE '%progress%' OR lower(`state`) = 'doing' THEN 'in_progress'
  ELSE 'todo'
END;--> statement-breakpoint
-- Jira already stored its status category next to the status name.
UPDATE `issues` SET `status_id` = CASE (
    SELECT json_extract(`metadata`, '$.statusCategory')
    FROM `entities` WHERE `entities`.`id` = `issues`.`entity_id`
  )
  WHEN 'new' THEN 'todo'
  WHEN 'indeterminate' THEN 'in_progress'
  WHEN 'done' THEN 'done'
  ELSE `status_id`
END
WHERE `provider` = 'jira';