CREATE TABLE `bridge_publications` (
  `table_name` text NOT NULL,
  `pk` text NOT NULL,
  `register` text NOT NULL,
  `stream` text NOT NULL,
  `image` text NOT NULL,
  `envelope` text NOT NULL,
  PRIMARY KEY (`table_name`,`pk`,`register`,`stream`)
);
--> statement-breakpoint
CREATE TABLE `bridge_writer_keys` (
  `backend_id` text NOT NULL,
  `signing_public_key` text NOT NULL,
  PRIMARY KEY (`backend_id`,`signing_public_key`)
);
