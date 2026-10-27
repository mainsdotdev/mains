ALTER TABLE `bridge_outbox` ADD `retry_generation` integer;--> statement-breakpoint
ALTER TABLE `bridge_outbox` ADD `retry_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bridge_outbox` ADD `retry_after_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bridge_outbox` ADD `retry_error` text;
