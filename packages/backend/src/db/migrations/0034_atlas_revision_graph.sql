ALTER TABLE `atlas_items` ADD `current_revision_id` text REFERENCES atlas_page_revisions(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `atlas_page_revisions` ADD `parent_revision_id` text REFERENCES atlas_page_revisions(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `atlas_page_revisions` ADD `merged_revision_id` text REFERENCES atlas_page_revisions(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_atlas_page_revisions_parent` ON `atlas_page_revisions` (`parent_revision_id`);--> statement-breakpoint
CREATE INDEX `idx_atlas_page_revisions_merged` ON `atlas_page_revisions` (`merged_revision_id`);--> statement-breakpoint
UPDATE atlas_page_revisions SET parent_revision_id = (
  SELECT previous.id FROM atlas_page_revisions previous
  WHERE previous.item_id = atlas_page_revisions.item_id AND previous.version < atlas_page_revisions.version
  ORDER BY previous.version DESC LIMIT 1
);--> statement-breakpoint
UPDATE atlas_items SET current_revision_id = (
  SELECT id FROM atlas_page_revisions WHERE item_id = atlas_items.id AND version = atlas_items.version
) WHERE kind = 'page';
