ALTER TABLE `bridge_row_clock` ADD `blob_refs_json` text;
--> statement-breakpoint
UPDATE `bridge_config` SET `backfill_done` = 0, `backfill_table` = NULL, `backfill_pk` = NULL;
