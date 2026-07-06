import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { items, users } from '../db/schema';
import { openD1Db } from './db-d1';

describe('db-d1', () => {
	it('migrations created the contract tables including search_fts', async () => {
		const tables = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table'"
		).all();
		const names = tables.results.map((r) => r.name);
		expect(names).toContain('users');
		expect(names).toContain('jobs');
		expect(names).toContain('search_fts');
	});

	it('round-trips a user row through drizzle', async () => {
		const db = openD1Db(env.DB);
		await db.insert(users).values({
			id: 'u1-d1-test',
			username: 'd1-owner',
			passwordHash: 'x',
			role: 'owner',
			accentColor: '#FA7B62',
			personId: null,
			comfortMode: false,
			theme: 'system',
			createdAt: new Date()
		});
		const rows = await db.select().from(users);
		expect(rows).toHaveLength(1);
		expect(rows[0].username).toBe('d1-owner');
		expect(rows[0].comfortMode).toBe(false);
		expect(rows[0].createdAt).toBeInstanceOf(Date);
	});

	it('finds a ready item by title through FTS5 MATCH', async () => {
		const db = openD1Db(env.DB);
		await db.insert(users).values({
			id: 'u-fts',
			username: 'fts-owner',
			passwordHash: 'x',
			role: 'owner',
			accentColor: '#FA7B62',
			personId: null,
			comfortMode: false,
			theme: 'system',
			createdAt: new Date()
		});
		await db.insert(items).values({
			id: 'i-fts',
			type: 'photo',
			title: 'Birthday at the lake',
			datePrecision: 'year',
			sortDate: '1994-01-01',
			width: 640,
			height: 480,
			sizeBytes: 1024,
			sha256: 'c'.repeat(64),
			source: 'upload',
			status: 'ready',
			uploadedBy: 'u-fts',
			createdAt: new Date()
		});
		const row = await env.DB.prepare('SELECT rowid FROM items WHERE id = ?')
			.bind('i-fts')
			.first<{ rowid: number }>();
		expect(row).not.toBeNull();
		await env.DB.prepare('INSERT INTO search_fts (rowid, item_id, title) VALUES (?, ?, ?)')
			.bind(row!.rowid, 'i-fts', 'Birthday at the lake')
			.run();
		const matched = await env.DB.prepare(
			"SELECT rowid FROM search_fts WHERE search_fts MATCH 'birthday'"
		).all();
		expect(matched.results).toHaveLength(1);
	});
});
