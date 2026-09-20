ALTER TABLE `collections` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_collections_account_sort` ON `collections` (`account_id`,`sort_order`);