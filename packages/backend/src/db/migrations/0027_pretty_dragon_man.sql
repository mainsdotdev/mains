CREATE TABLE `run_attachment_refs` (
	`run_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`input_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`run_id`, `attachment_id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `run_attachments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_run_attachment_refs_input` ON `run_attachment_refs` (`run_id`,`input_key`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_run_attachment_refs_attachment` ON `run_attachment_refs` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `run_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`mime_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_run_attachments_storage_key` ON `run_attachments` (`storage_key`);