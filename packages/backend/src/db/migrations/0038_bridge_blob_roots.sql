ALTER TABLE `bridge_config` ADD `blob_roots_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `bridge_config` SET `backfill_done`=0, `backfill_table`=NULL, `backfill_pk`=NULL;
