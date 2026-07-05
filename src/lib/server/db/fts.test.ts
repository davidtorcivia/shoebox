import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../platform/node-test-db';

describe('search_fts v2 migration', () => {
	it('runs on SQLite with contentless_delete support', () => {
		const { sqlite } = makeTestDb();
		const { v } = sqlite.prepare('select sqlite_version() as v').get() as { v: string };
		const [major, minor] = v.split('.').map(Number);
		expect(major > 3 || (major === 3 && minor >= 43)).toBe(true);
	});

	it('supports insert, MATCH by rowid, and plain DELETE by rowid', async () => {
		const { db } = makeTestDb();
		await db.run(
			sql`INSERT INTO search_fts (rowid, item_id, title, description, people, tags, albums, comments)
			    VALUES (1, 'it_x', 'Lake day', 'eating watermelon', 'Eric', 'summer', 'Summers', 'great clip')`
		);

		const hits = (await db.all(
			sql`SELECT rowid AS r FROM search_fts WHERE search_fts MATCH '"watermelon"'`
		)) as { r: number }[];
		expect(hits.map((hit) => hit.r)).toEqual([1]);

		await db.run(sql`DELETE FROM search_fts WHERE rowid = 1`);
		const after = (await db.all(
			sql`SELECT rowid FROM search_fts WHERE search_fts MATCH '"watermelon"'`
		)) as unknown[];
		expect(after).toEqual([]);
	});

	it('delete-all command wipes the index', async () => {
		const { db } = makeTestDb();
		await db.run(
			sql`INSERT INTO search_fts (rowid, item_id, title, description, people, tags, albums, comments)
			    VALUES (2, 'it_y', 'Bike', '', '', '', '', '')`
		);
		await db.run(sql`INSERT INTO search_fts(search_fts) VALUES ('delete-all')`);
		expect(
			(await db.all(sql`SELECT rowid FROM search_fts WHERE search_fts MATCH '"bike"'`)) as unknown[]
		).toEqual([]);
	});
});
