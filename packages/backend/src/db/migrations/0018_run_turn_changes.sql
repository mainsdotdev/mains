CREATE TABLE `run_turn_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`turn_id` integer NOT NULL,
	`diff_text` text NOT NULL,
	`files_json` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`undone_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `run_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_run_turn_changes_files_json" CHECK(json_valid("run_turn_changes"."files_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_run_turn_changes_run` ON `run_turn_changes` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_run_turn_changes_turn` ON `run_turn_changes` (`turn_id`);