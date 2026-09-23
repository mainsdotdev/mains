CREATE VIRTUAL TABLE `run_artifacts_fts` USING fts5(
	`content`,
	`run_id` UNINDEXED,
	`artifact_kind` UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);--> statement-breakpoint
INSERT INTO `run_artifacts_fts` (`rowid`, `content`, `run_id`, `artifact_kind`)
SELECT `id`, `content`, `run_id`, `kind`
FROM `run_artifacts`
WHERE length(trim(coalesce(`content`, ''))) > 0
	AND (
		`kind` IN ('user-prompt', 'report', 'result')
		OR json_extract(`metadata`, '$.kind') IN ('user-prompt', 'report', 'result')
	);--> statement-breakpoint
CREATE TRIGGER `run_artifacts_fts_after_insert`
AFTER INSERT ON `run_artifacts`
WHEN length(trim(coalesce(NEW.`content`, ''))) > 0
	AND (
		NEW.`kind` IN ('user-prompt', 'report', 'result')
		OR json_extract(NEW.`metadata`, '$.kind') IN ('user-prompt', 'report', 'result')
	)
BEGIN
	INSERT INTO `run_artifacts_fts` (`rowid`, `content`, `run_id`, `artifact_kind`)
	VALUES (NEW.`id`, NEW.`content`, NEW.`run_id`, NEW.`kind`);
END;--> statement-breakpoint
CREATE TRIGGER `run_artifacts_fts_after_update`
AFTER UPDATE OF `content`, `run_id`, `kind`, `metadata` ON `run_artifacts`
BEGIN
	DELETE FROM `run_artifacts_fts` WHERE `rowid` = OLD.`id`;
	INSERT INTO `run_artifacts_fts` (`rowid`, `content`, `run_id`, `artifact_kind`)
	SELECT NEW.`id`, NEW.`content`, NEW.`run_id`, NEW.`kind`
	WHERE length(trim(coalesce(NEW.`content`, ''))) > 0
		AND (
			NEW.`kind` IN ('user-prompt', 'report', 'result')
			OR json_extract(NEW.`metadata`, '$.kind') IN ('user-prompt', 'report', 'result')
		);
END;--> statement-breakpoint
CREATE TRIGGER `run_artifacts_fts_after_delete`
AFTER DELETE ON `run_artifacts`
BEGIN
	DELETE FROM `run_artifacts_fts` WHERE `rowid` = OLD.`id`;
END;
