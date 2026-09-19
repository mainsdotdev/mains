ALTER TABLE `app_settings` ADD `appshots_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `appshots_shortcut` text DEFAULT 'Command+Shift+Space' NOT NULL;