ALTER TABLE `tool_calls` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `tool_calls` SET `updated_at` = `created_at`;--> statement-breakpoint
CREATE INDEX `idx_tool_calls_run_updated` ON `tool_calls` (`run_id`,`updated_at`);
