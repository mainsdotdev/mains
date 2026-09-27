ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY account_id ORDER BY name COLLATE NOCASE, id
  ) - 1 AS position FROM projects
)
UPDATE projects SET sort_order = (
  SELECT position FROM ranked WHERE ranked.id = projects.id
);--> statement-breakpoint
CREATE INDEX `idx_projects_account_sort` ON `projects` (`account_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY account_id ORDER BY updated_at DESC, id
  ) - 1 AS position FROM workspaces
)
UPDATE workspaces SET sort_order = (
  SELECT position FROM ranked WHERE ranked.id = workspaces.id
);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `pinned_at` integer;--> statement-breakpoint
CREATE INDEX `idx_workspaces_account_sort` ON `workspaces` (`account_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_pinned` ON `workspaces` (`pinned_at`);
