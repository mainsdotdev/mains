DROP INDEX `uniq_ct_conn_current`;--> statement-breakpoint
ALTER TABLE `connection_tokens` ADD `encryption_format` text DEFAULT 'unversioned' NOT NULL;--> statement-breakpoint
UPDATE `connection_tokens`
SET `encryption_format` = 'mns1-aes-gcm-v1'
WHERE substr(`access_token_enc`, 1, 4) = X'4D4E5331';--> statement-breakpoint
WITH `active_connections` AS (
  SELECT DISTINCT `connection_id`
  FROM `connection_tokens`
  WHERE `is_current` = 1
),
`latest_by_format` AS (
  SELECT MAX(`id`) AS `id`
  FROM `connection_tokens`
  WHERE `connection_id` IN (SELECT `connection_id` FROM `active_connections`)
  GROUP BY `connection_id`, `encryption_format`
)
UPDATE `connection_tokens`
SET `is_current` = 1
WHERE `id` IN (SELECT `id` FROM `latest_by_format`);--> statement-breakpoint
CREATE INDEX `idx_ct_encryption_format` ON `connection_tokens` (`encryption_format`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_ct_conn_format_current` ON `connection_tokens` (`connection_id`,`encryption_format`) WHERE "connection_tokens"."is_current" = 1;
