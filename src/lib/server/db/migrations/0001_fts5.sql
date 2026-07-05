CREATE VIRTUAL TABLE search_fts USING fts5(
	item_id UNINDEXED,
	title,
	description,
	people,
	tags,
	albums,
	comments,
	content=''
);
