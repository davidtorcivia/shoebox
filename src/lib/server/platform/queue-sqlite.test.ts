import { describe, expect, it } from 'vitest';
import { jobs } from '../db/schema';
import { openNodeDb } from './db-node';
import { createSqliteQueue } from './queue-sqlite';

describe('openNodeDb', () => {
	it('opens an in-memory db with migrations applied', async () => {
		const db = openNodeDb(':memory:');
		const rows = await db.select().from(jobs);
		expect(rows).toEqual([]);
	});
});

describe('queue-sqlite enqueue', () => {
	it('inserts a pending job with JSON payload and defaults runAfter to now', async () => {
		const db = openNodeDb(':memory:');
		const queue = createSqliteQueue(db);
		const before = Date.now();
		await queue.enqueue('derivatives', { itemId: 'abc123' });
		const rows = await db.select().from(jobs);
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('derivatives');
		expect(JSON.parse(rows[0].payload)).toEqual({ itemId: 'abc123' });
		expect(rows[0].status).toBe('pending');
		expect(rows[0].attempts).toBe(0);
		expect(rows[0].runAfter.getTime()).toBeGreaterThanOrEqual(before - 1000);
		expect(rows[0].runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
	});

	it('honors an explicit runAfter', async () => {
		const db = openNodeDb(':memory:');
		const queue = createSqliteQueue(db);
		const later = new Date(Date.now() + 60_000);
		await queue.enqueue('sprite', { itemId: 'xyz' }, later);
		const rows = await db.select().from(jobs);
		expect(Math.abs(rows[0].runAfter.getTime() - later.getTime())).toBeLessThan(1000);
	});
});
