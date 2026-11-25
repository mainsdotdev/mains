CREATE TABLE `assistant_welcomes` (
	`assistant_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`was_skipped` integer DEFAULT false NOT NULL,
	`question` text,
	`setup_prompt` text,
	`answer` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_assistant_welcome_question_json" CHECK(json_valid("assistant_welcomes"."question") OR "assistant_welcomes"."question" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assistant_welcomes_run` ON `assistant_welcomes` (`run_id`);