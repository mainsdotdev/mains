CREATE TABLE `bridge_aliases` (
	`table_name` text NOT NULL,
	`alias_pk` text NOT NULL,
	`canonical_pk` text NOT NULL,
	PRIMARY KEY(`table_name`, `alias_pk`)
);
--> statement-breakpoint
CREATE INDEX `idx_bridge_aliases_canonical` ON `bridge_aliases` (`table_name`,`canonical_pk`);--> statement-breakpoint
CREATE TABLE `bridge_clock` (
	`id` integer PRIMARY KEY NOT NULL,
	`physical_ms` integer DEFAULT 0 NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "check_bridge_clock_singleton" CHECK("bridge_clock"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `bridge_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`backend_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`atlas_enabled` integer DEFAULT false NOT NULL,
	`backfill_table` text,
	`backfill_pk` text,
	`backfill_done` integer DEFAULT false NOT NULL,
	CONSTRAINT "check_bridge_config_singleton" CHECK("bridge_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `bridge_cursors` (
	`stream` text PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bridge_exclusions` (
	`table_name` text NOT NULL,
	`pk` text NOT NULL,
	PRIMARY KEY(`table_name`, `pk`)
);
--> statement-breakpoint
CREATE TABLE `bridge_id_map` (
	`owner_backend_id` text NOT NULL,
	`table_name` text NOT NULL,
	`remote_id` text NOT NULL,
	`local_id` integer NOT NULL,
	PRIMARY KEY(`owner_backend_id`, `table_name`, `remote_id`)
);
--> statement-breakpoint
CREATE TABLE `bridge_outbox` (
	`table_name` text NOT NULL,
	`pk` text NOT NULL,
	`register` text NOT NULL,
	`op` text NOT NULL,
	`generation` integer NOT NULL,
	`stream` text NOT NULL,
	`owner` text,
	`run_id` text,
	`changed_at` integer NOT NULL,
	PRIMARY KEY(`table_name`, `pk`, `register`)
);
--> statement-breakpoint
CREATE INDEX `idx_bridge_outbox_stream` ON `bridge_outbox` (`stream`,`generation`);--> statement-breakpoint
CREATE TABLE `bridge_parked` (
	`stream` text NOT NULL,
	`seq` integer NOT NULL,
	`envelope` text NOT NULL,
	`reason` text NOT NULL,
	PRIMARY KEY(`stream`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `bridge_pending_links` (
	`table_name` text NOT NULL,
	`pk` text NOT NULL,
	`register` text NOT NULL,
	`column_name` text NOT NULL,
	`parent_table` text NOT NULL,
	`parent_pk` text NOT NULL,
	`owner` text NOT NULL,
	`physical_ms` integer NOT NULL,
	`counter` integer NOT NULL,
	`origin` text NOT NULL,
	PRIMARY KEY(`table_name`, `pk`, `register`, `column_name`)
);
--> statement-breakpoint
CREATE TABLE `bridge_row_clock` (
	`table_name` text NOT NULL,
	`pk` text NOT NULL,
	`register` text NOT NULL,
	`physical_ms` integer NOT NULL,
	`counter` integer NOT NULL,
	`origin` text NOT NULL,
	`synced_seq` integer,
	`values_json` text NOT NULL,
	`refs_json` text DEFAULT '{}' NOT NULL,
	`portable` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`table_name`, `pk`, `register`)
);
--> statement-breakpoint
CREATE TABLE `bridge_tombstones` (
	`table_name` text NOT NULL,
	`pk` text NOT NULL,
	`envelope` text,
	PRIMARY KEY(`table_name`, `pk`)
);
