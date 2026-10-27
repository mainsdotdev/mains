ALTER TABLE bridge_config ADD COLUMN tracking_enabled integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN account_id text;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN hub_origin text;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN enrollment_staging integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN dev_disabled integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN logout_pending integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN logout_revoked integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_config ADD COLUMN logout_remove_synced integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_row_clock ADD COLUMN dirty integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_row_clock ADD COLUMN project_id text;
--> statement-breakpoint
ALTER TABLE bridge_tombstones ADD COLUMN stream text DEFAULT 'account' NOT NULL;
--> statement-breakpoint
ALTER TABLE bridge_tombstones ADD COLUMN owner text;
--> statement-breakpoint
ALTER TABLE bridge_tombstones ADD COLUMN run_id text;
--> statement-breakpoint
ALTER TABLE bridge_tombstones ADD COLUMN project_id text;
--> statement-breakpoint
ALTER TABLE bridge_exclusions ADD COLUMN reason text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
UPDATE bridge_config SET tracking_enabled=1 WHERE enabled=1 OR account_fingerprint IS NOT NULL;
--> statement-breakpoint
UPDATE bridge_row_clock SET dirty=1 WHERE EXISTS(SELECT 1 FROM bridge_outbox o WHERE o.table_name=bridge_row_clock.table_name AND o.pk=bridge_row_clock.pk AND o.register=bridge_row_clock.register);
--> statement-breakpoint
UPDATE bridge_exclusions SET reason='history' WHERE table_name IN ('runs','atlas_items');
--> statement-breakpoint
UPDATE bridge_tombstones SET stream=coalesce((SELECT stream FROM bridge_outbox o WHERE o.table_name=bridge_tombstones.table_name AND o.pk=bridge_tombstones.pk LIMIT 1),json_extract(envelope,'$.header.stream'),'account'), owner=coalesce((SELECT owner FROM bridge_outbox o WHERE o.table_name=bridge_tombstones.table_name AND o.pk=bridge_tombstones.pk LIMIT 1),json_extract(envelope,'$.header.owner')),run_id=coalesce((SELECT run_id FROM bridge_outbox o WHERE o.table_name=bridge_tombstones.table_name AND o.pk=bridge_tombstones.pk LIMIT 1),json_extract(envelope,'$.header.runId'));
