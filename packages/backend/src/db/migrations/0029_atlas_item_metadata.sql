-- Additive migration: preserve Pages, revisions and their file references.
ALTER TABLE `atlas_items` ADD COLUMN `metadata` text
  CONSTRAINT `check_atlas_items_metadata_json`
  CHECK(json_valid(`metadata`) OR `metadata` IS NULL);
