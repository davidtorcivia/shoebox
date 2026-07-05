import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { users } from '../db/schema';
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
});
