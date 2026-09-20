ALTER TABLE `runs` ADD `pinned_at` integer;--> statement-breakpoint
CREATE INDEX `idx_runs_pinned` ON `runs` (`pinned_at`);