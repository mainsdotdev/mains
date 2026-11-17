ALTER TABLE `pulses` ADD `assistant_id` text;--> statement-breakpoint
ALTER TABLE `pulses` ADD `last_assignment_id` text;--> statement-breakpoint
CREATE INDEX `idx_pulses_assistant` ON `pulses` (`assistant_id`);