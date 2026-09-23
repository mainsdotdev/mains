ALTER TABLE `app_settings` ADD `backend_remote_access` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backend_lan_access` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backend_tailscale_https` integer DEFAULT false NOT NULL;