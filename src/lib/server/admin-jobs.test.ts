import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from './db/test-db';
import { jobs } from './db/schema';
import { listJobs, retryJob } from './admin-jobs';
import type { Db } from './db';

let db: Db;
const NOW = new Date('2026-07-05T12:00:00Z');

beforeEach(async () => {
	db = createTestDb();
	await db.insert(jobs).values([
		{
			id: 'j_failed',
			kind: 'derivatives',
			payload: JSON.stringify({ itemId: 'it_1', reason: 'ffmpeg exit 1' }),
			status: 'failed',
			attempts: 3,
			runAfter: NOW,
			createdAt: new Date('2026-07-05T12:03:00Z')
		},
		{
			id: 'j_pending',
			kind: 'sprite',
			payload: '{"itemId":"it_2"}',
			status: 'pending',
			attempts: 0,
			runAfter: NOW,
			createdAt: new Date('2026-07-05T12:02:00Z')
		},
		{
			id: 'j_running',
			kind: 'ingest_scan',
			payload: '{}',
			status: 'running',
			attempts: 1,
			runAfter: NOW,
			createdAt: new Date('2026-07-05T12:01:00Z')
		},
		{
			id: 'j_done',
			kind: 'ingest_scan',
			payload: '{}',
			status: 'done',
			attempts: 1,
			runAfter: NOW,
			createdAt: new Date('2026-07-05T12:04:00Z')
		}
	]);
});

describe('listJobs', () => {
	it('lists pending, running, and failed jobs newest first', async () => {
		const rows = await listJobs(db);
		expect(rows.map((row) => row.id)).toEqual(['j_failed', 'j_pending', 'j_running']);
	});
});

describe('retryJob', () => {
	it('re-pends a failed job and resets runAfter', async () => {
		expect(await retryJob(db, 'j_failed')).toBe(true);
		const row = (await db.select().from(jobs).where(eq(jobs.id, 'j_failed')))[0];
		expect(row.status).toBe('pending');
		expect(row.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it('refuses non-failed or missing jobs', async () => {
		expect(await retryJob(db, 'j_pending')).toBe(false);
		expect(await retryJob(db, 'j_missing')).toBe(false);
	});
});
