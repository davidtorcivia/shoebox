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
});
