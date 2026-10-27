CREATE TABLE `bridge_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`applying` integer DEFAULT false NOT NULL,
	CONSTRAINT "check_bridge_state_singleton" CHECK("bridge_state"."id" = 1)
);

--> statement-breakpoint
DROP INDEX `uniq_spaces_account_slug`;--> statement-breakpoint
DROP INDEX `uniq_spaces_account_name`;--> statement-breakpoint
CREATE INDEX `idx_spaces_account_slug` ON `spaces` (`account_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_spaces_account_name` ON `spaces` (`account_id`,`name`);--> statement-breakpoint
DROP INDEX `uniq_projects_account_origin`;--> statement-breakpoint
DROP INDEX `uniq_projects_account_root`;--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_backend_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_projects_account_origin` ON `projects` (`account_id`,`owner_backend_id`,`remote_origin`) WHERE "projects"."remote_origin" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_projects_account_root` ON `projects` (`account_id`,`owner_backend_id`,`root_path`) WHERE "projects"."remote_origin" IS NULL;--> statement-breakpoint
DROP INDEX `uniq_workspaces_account_root`;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `owner_backend_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspaces_account_root` ON `workspaces` (`account_id`,`owner_backend_id`,`root_path`);--> statement-breakpoint
ALTER TABLE `automations` ADD `owner_backend_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pulses` ADD `owner_backend_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `owner_backend_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE app_settings SET backend_id = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) WHERE id = 'default' AND (backend_id IS NULL OR backend_id = '');
--> statement-breakpoint
UPDATE projects SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE owner_backend_id = '';
--> statement-breakpoint
CREATE TRIGGER projects_local_owner AFTER INSERT ON projects
WHEN NEW.owner_backend_id = ''
BEGIN
  UPDATE projects SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE id = NEW.id;
END;
--> statement-breakpoint
UPDATE workspaces SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE owner_backend_id = '';
--> statement-breakpoint
CREATE TRIGGER workspaces_local_owner AFTER INSERT ON workspaces
WHEN NEW.owner_backend_id = ''
BEGIN
  UPDATE workspaces SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE id = NEW.id;
END;
--> statement-breakpoint
UPDATE runs SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE owner_backend_id = '';
--> statement-breakpoint
CREATE TRIGGER runs_local_owner AFTER INSERT ON runs
WHEN NEW.owner_backend_id = ''
BEGIN
  UPDATE runs SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE id = NEW.id;
END;
--> statement-breakpoint
UPDATE pulses SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE owner_backend_id = '';
--> statement-breakpoint
CREATE TRIGGER pulses_local_owner AFTER INSERT ON pulses
WHEN NEW.owner_backend_id = ''
BEGIN
  UPDATE pulses SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE id = NEW.id;
END;
--> statement-breakpoint
UPDATE automations SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE owner_backend_id = '';
--> statement-breakpoint
CREATE TRIGGER automations_local_owner AFTER INSERT ON automations
WHEN NEW.owner_backend_id = ''
BEGIN
  UPDATE automations SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE id = NEW.id;
END;
--> statement-breakpoint

INSERT OR IGNORE INTO bridge_state(id, applying) VALUES (1, 0);
