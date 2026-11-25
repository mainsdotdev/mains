ALTER TABLE `assistant_assignments` ADD `execution` text DEFAULT '{"mode":"work"}' NOT NULL CONSTRAINT `check_assistant_execution_json` CHECK(json_valid(`execution`));
--> statement-breakpoint
ALTER TABLE `assistant_assignments` ADD `source_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `assistant_assignments` ADD `source_context_id` integer;
--> statement-breakpoint
ALTER TABLE `assistant_assignments` ADD `context` text DEFAULT '{}' NOT NULL CONSTRAINT `check_assistant_task_context_json` CHECK(json_valid(`context`));
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assistant_assignments_context` ON `assistant_assignments` (`source_context_id`);
--> statement-breakpoint
ALTER TABLE `assistants` ADD `avatar` text DEFAULT '{"shape":"circle","color":"blue"}' NOT NULL CONSTRAINT `check_assistants_avatar_json` CHECK(json_valid(`avatar`));
--> statement-breakpoint
UPDATE `assistant_assignments`
SET `execution` = CASE
  WHEN COALESCE((SELECT `mode` FROM `runs` WHERE `id` = `assistant_assignments`.`worker_run_id`), (SELECT `mode` FROM `assistants` WHERE `id` = `assistant_assignments`.`to_assistant_id`)) = 'developer'
  THEN json_object('mode', 'developer', 'workspaceId', COALESCE((SELECT `workspace_id` FROM `runs` WHERE `id` = `assistant_assignments`.`worker_run_id`), (SELECT `workspace_id` FROM `assistants` WHERE `id` = `assistant_assignments`.`to_assistant_id`)))
  ELSE json_object('mode', 'work') END;
