ALTER TABLE `runs` ADD `mode` text DEFAULT 'developer' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_runs_mode` ON `runs` (`mode`);