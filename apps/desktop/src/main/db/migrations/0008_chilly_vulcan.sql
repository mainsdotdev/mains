ALTER TABLE `workspaces` ADD `base_branch` text;--> statement-breakpoint
UPDATE `workspaces`
SET `base_branch` = COALESCE(
  NULLIF(json_extract(`metadata`, '$.baseBranch'), ''),
  (
    SELECT `projects`.`default_branch`
    FROM `projects`
    WHERE `projects`.`id` = `workspaces`.`project_id`
  ),
  `default_branch`
);--> statement-breakpoint
UPDATE `workspaces`
SET `metadata` = json_remove(
  `metadata`,
  '$.baseBranch',
  '$.worktree.branch'
)
WHERE `metadata` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` DROP COLUMN `default_branch`;
