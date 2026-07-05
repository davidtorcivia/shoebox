DROP TABLE IF EXISTS `search_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	`item_id` UNINDEXED,
	`title`,
	`description`,
	`people`,
	`tags`,
	`albums`,
	`comments`,
	content='',
	contentless_delete=1,
	tokenize='unicode61 remove_diacritics 2'
);
