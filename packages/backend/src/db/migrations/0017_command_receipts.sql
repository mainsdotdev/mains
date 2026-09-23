CREATE TABLE `command_receipts` (
	`device_id` text NOT NULL,
	`command_id` text NOT NULL,
	`channel` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`device_id`, `command_id`),
	FOREIGN KEY (`device_id`) REFERENCES `paired_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_command_receipts_created_at` ON `command_receipts` (`created_at`);