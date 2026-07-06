import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';

const ALL_TABLES = [
	'users',
	'sessions',
	'invites',
	'items',
	'item_files',
	'people',
	'relationships',
	'item_people',
	'tags',
	'item_tags',
	'albums',
	'album_items',
	'comments',
	'shares',
	'faces',
	'jobs',
	'settings',
	'year_counts',
	'search_fts'
];

describe('migrations', () => {
	it('create every Contract 1 table plus the FTS5 virtual table', () => {
		const sqlite = new Database(':memory:');
		const db = drizzle(sqlite);
		migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
		const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
			name: string;
		}[];
		const names = rows.map((r) => r.name);
		for (const table of ALL_TABLES) expect(names, `missing table ${table}`).toContain(table);
	});

	it('search_fts is contentless with the contracted columns', () => {
		const sqlite = new Database(':memory:');
		migrate(drizzle(sqlite), { migrationsFolder: 'src/lib/server/db/migrations' });
		const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'search_fts'").get() as {
			sql: string;
		};
		expect(row.sql).toContain('fts5');
		expect(row.sql).toContain("content=''");
		for (const col of ['item_id', 'title', 'description', 'people', 'tags', 'albums', 'comments']) {
			expect(row.sql).toContain(col);
		}
	});

	it('creates every hot-path index needed by the documented queries', () => {
		const sqlite = new Database(':memory:');
		migrate(drizzle(sqlite), { migrationsFolder: 'src/lib/server/db/migrations' });
		const names = indexNames(sqlite);
		for (const idx of HOT_INDEXES) expect(names, `missing index ${idx}`).toContain(idx);
	});

	it('is idempotent: a second migrate() over the same db is a safe no-op', () => {
		// App and worker both call openNodeDb() (which runs migrate) at startup on the
		// same file. The second pass must not throw once migrations are recorded.
		const sqlite = new Database(':memory:');
		const db = drizzle(sqlite);
		migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
		expect(() => migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' })).not.toThrow();
	});
});

const HOT_INDEXES = [
	'item_people_person',
	'album_items_album_position',
	'comments_item',
	'faces_item',
	'jobs_claim',
	'items_sort',
	'shares_token_unique',
	'item_tags_tag'
] as const;

function indexNames(sqlite: Database.Database): string[] {
	const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
		name: string;
	}[];
	return rows.map((r) => r.name);
}
