import {
	blob,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role', { enum: ['owner', 'admin', 'editor', 'uploader', 'user'] }).notNull(),
	accentColor: text('accent_color').notNull(),
	avatarStorageKey: text('avatar_storage_key'),
	avatarMime: text('avatar_mime'),
	personId: text('person_id'),
	comfortMode: integer('comfort_mode', { mode: 'boolean' }).notNull().default(false),
	theme: text('theme', { enum: ['system', 'dark', 'light'] })
		.notNull()
		.default('system'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const invites = sqliteTable('invites', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(),
	role: text('role', { enum: ['admin', 'editor', 'uploader', 'user'] }).notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }),
	maxUses: integer('max_uses').notNull().default(1),
	useCount: integer('use_count').notNull().default(0),
	createdBy: text('created_by')
		.notNull()
		.references(() => users.id)
});

export const items = sqliteTable(
	'items',
	{
		id: text('id').primaryKey(),
		type: text('type', { enum: ['video', 'photo'] }).notNull(),
		title: text('title'),
		description: text('description'),
		dateStart: text('date_start'),
		dateEnd: text('date_end'),
		datePrecision: text('date_precision', { enum: ['day', 'month', 'year', 'range', 'unknown'] })
			.notNull()
			.default('unknown'),
		sortDate: text('sort_date'),
		duration: real('duration'),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		sha256: text('sha256').notNull(),
		blurhash: text('blurhash'),
		source: text('source', { enum: ['upload', 'ingest'] }).notNull(),
		tapeLabel: text('tape_label'),
		status: text('status', { enum: ['processing', 'needs_review', 'ready'] }).notNull(),
		uploadedBy: text('uploaded_by')
			.notNull()
			.references(() => users.id),
		deletedAt: integer('deleted_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [
		index('items_sort').on(t.sortDate),
		index('items_status').on(t.status),
		index('items_sha').on(t.sha256)
	]
);

export const itemFiles = sqliteTable(
	'item_files',
	{
		id: text('id').primaryKey(),
		itemId: text('item_id')
			.notNull()
			.references(() => items.id),
		kind: text('kind', {
			enum: ['original', 'poster', 'thumb_400', 'thumb_800', 'thumb_1600', 'sprite']
		}).notNull(),
		storageKey: text('storage_key').notNull(),
		mime: text('mime').notNull(),
		width: integer('width'),
		height: integer('height')
	},
	(t) => [index('item_files_item').on(t.itemId)]
);

export const people = sqliteTable(
	'people',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		nickname: text('nickname'),
		birthdate: text('birthdate'),
		deathDate: text('death_date'),
		birthPlace: text('birth_place'),
		bio: text('bio'),
		avatarItemId: text('avatar_item_id'),
		avatarCrop: text('avatar_crop'),
		accentColor: text('accent_color').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [uniqueIndex('people_slug_unique').on(t.slug)]
);

export const relationships = sqliteTable(
	'relationships',
	{
		id: text('id').primaryKey(),
		personA: text('person_a')
			.notNull()
			.references(() => people.id),
		personB: text('person_b')
			.notNull()
			.references(() => people.id),
		type: text('type', { enum: ['parent-of', 'spouse-of', 'sibling-of'] }).notNull()
	},
	(t) => [uniqueIndex('rel_unique').on(t.personA, t.personB, t.type)]
);

export const itemPeople = sqliteTable(
	'item_people',
	{
		itemId: text('item_id')
			.notNull()
			.references(() => items.id),
		personId: text('person_id')
			.notNull()
			.references(() => people.id),
		faceBox: text('face_box'),
		source: text('source', { enum: ['manual', 'ml'] })
			.notNull()
			.default('manual')
	},
	(t) => [primaryKey({ columns: [t.itemId, t.personId] }), index('item_people_person').on(t.personId)]
);

export const tags = sqliteTable('tags', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	kind: text('kind', { enum: ['topic', 'holiday'] })
		.notNull()
		.default('topic')
});

export const itemTags = sqliteTable(
	'item_tags',
	{
		itemId: text('item_id')
			.notNull()
			.references(() => items.id),
		tagId: text('tag_id')
			.notNull()
			.references(() => tags.id)
	},
	(t) => [primaryKey({ columns: [t.itemId, t.tagId] }), index('item_tags_tag').on(t.tagId)]
);

export const albums = sqliteTable('albums', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	description: text('description'),
	coverItemId: text('cover_item_id'),
	createdBy: text('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	deletedAt: integer('deleted_at', { mode: 'timestamp' })
});

export const albumItems = sqliteTable(
	'album_items',
	{
		albumId: text('album_id')
			.notNull()
			.references(() => albums.id),
		itemId: text('item_id')
			.notNull()
			.references(() => items.id),
		position: integer('position').notNull()
	},
	(t) => [primaryKey({ columns: [t.albumId, t.itemId] }), index('album_items_album_position').on(t.albumId, t.position)]
);

export const comments = sqliteTable('comments', {
	id: text('id').primaryKey(),
	itemId: text('item_id')
		.notNull()
		.references(() => items.id),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	body: text('body').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	deletedAt: integer('deleted_at', { mode: 'timestamp' })
}, (t) => [index('comments_item').on(t.itemId)]);

export const shares = sqliteTable('shares', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(),
	targetType: text('target_type', { enum: ['album', 'item'] }).notNull(),
	targetId: text('target_id').notNull(),
	passwordHash: text('password_hash'),
	expiresAt: integer('expires_at', { mode: 'timestamp' }),
	allowDownload: integer('allow_download', { mode: 'boolean' }).notNull().default(false),
	createdBy: text('created_by')
		.notNull()
		.references(() => users.id)
});

export const faces = sqliteTable('faces', {
	id: text('id').primaryKey(),
	itemId: text('item_id')
		.notNull()
		.references(() => items.id),
	frameTime: real('frame_time'),
	box: text('box').notNull(),
	embedding: blob('embedding', { mode: 'buffer' }).notNull(),
	clusterId: text('cluster_id'),
	personId: text('person_id'),
	status: text('status', { enum: ['pending', 'confirmed', 'rejected'] })
		.notNull()
		.default('pending')
}, (t) => [index('faces_item').on(t.itemId)]);

export const jobs = sqliteTable(
	'jobs',
	{
		id: text('id').primaryKey(),
		kind: text('kind', { enum: ['derivatives', 'sprite', 'ingest_scan', 'face_scan'] }).notNull(),
		payload: text('payload').notNull(),
		status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		runAfter: integer('run_after', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('jobs_claim').on(t.status, t.runAfter)]
);

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const yearCounts = sqliteTable(
	'year_counts',
	{
		year: integer('year').notNull(),
		type: text('type', { enum: ['video', 'photo'] }).notNull(),
		count: integer('count').notNull()
	},
	(t) => [primaryKey({ columns: [t.year, t.type] })]
);
