CREATE TABLE `bridge_publications` (
  `table_name` text NOT NULL,
  `pk` text NOT NULL,
  `register` text NOT NULL,
  `stream` text NOT NULL,
  `image` text NOT NULL,
  `envelope` text NOT NULL,
  PRIMARY KEY (`table_name`,`pk`,`register`,`stream`)
);
