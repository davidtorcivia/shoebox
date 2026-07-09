import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as schema from '../lib/server/db/schema';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import {
	claimJob,
	logIngestFailure,
	MAX_ATTEMPTS,
	runJob,
	STALE_CLAIM_SECONDS,
	type WorkerContext
} from './jobs';
import { createTestDb, insertJob } from './test-helpers';

function testCtx(db: ReturnType<typeof createTestDb>): WorkerContext {
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	return { db, storage: createFsStorage(mediaPath), mediaPath };
}

describe('claimJob', () => {
	it('returns null when no jobs are pending', () => {
		const db = createTestDb();
		expect(claimJob(db, ['derivatives', 'sprite'])).toBeNull();
	});

	it('claims the oldest eligible pending job of a handled kind and marks it running', () => {
		const db = createTestDb();
		const older = insertJob(db, {
			kind: 'sprite',
			payload: { itemId: 'a' },
			createdAt: new Date('2026-01-01T00:00:00Z')
		});
		insertJob(db, {
			kind: 'derivatives',
			payload: { itemId: 'b' },
			createdAt: new Date('2026-01-02T00:00:00Z')
		});
		const job = claimJob(db, ['derivatives', 'sprite']);
		expect(job).not.toBeNull();
		expect(job!.id).toBe(older);
		expect(job!.kind).toBe('sprite');
		expect(job!.payload).toEqual({ itemId: 'a' });
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, older)).get();
		expect(row!.status).toBe('running');
	});

	it('skips jobs with run_after in the future', () => {
		const db = createTestDb();
		insertJob(db, { kind: 'derivatives', runAfter: new Date(Date.now() + 60_000) });
		expect(claimJob(db, ['derivatives'])).toBeNull();
	});

	it('skips kinds it does not handle', () => {
		const db = createTestDb();
		insertJob(db, { kind: 'face_scan' });
		insertJob(db, { kind: 'ingest_scan', status: 'failed' });
		expect(claimJob(db, ['derivatives', 'sprite'])).toBeNull();
	});

	it('never claims the same job twice', () => {
		const db = createTestDb();
		insertJob(db, { kind: 'derivatives' });
		expect(claimJob(db, ['derivatives'])).not.toBeNull();
		expect(claimJob(db, ['derivatives'])).toBeNull();
	});
});

describe('claimJob stale recovery', () => {
	it('reclaims a job stuck in running longer than the stale threshold', () => {
		const db = createTestDb();
		const stale = Math.floor(Date.now() / 1000) - (STALE_CLAIM_SECONDS + 60);
		const id = insertJob(db, {
			kind: 'derivatives',
			status: 'running',
			attempts: 2,
			payload: { itemId: 'stuck', claimedAt: stale }
		});
		const job = claimJob(db, ['derivatives']);
		expect(job).not.toBeNull();
		expect(job!.id).toBe(id);
		// claimedAt is operational bookkeeping, stripped from the handler payload
		expect(job!.payload).toEqual({ itemId: 'stuck' });
		// reclaim counts as an attempt so a perpetually-crashing job eventually fails
		expect(job!.attempts).toBe(3);
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
		expect(row.status).toBe('running');
	});

	it('does not reclaim a running job claimed recently', () => {
		const db = createTestDb();
		const recent = Math.floor(Date.now() / 1000) - 10;
		const id = insertJob(db, {
			kind: 'derivatives',
			status: 'running',
			attempts: 0,
			payload: { itemId: 'fresh', claimedAt: recent }
		});
		expect(claimJob(db, ['derivatives'])).toBeNull();
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
		expect(row.status).toBe('running');
		expect(row.attempts).toBe(0);
	});

	it('fails a stuck job once it has exhausted its retries', () => {
		const db = createTestDb();
		const stale = Math.floor(Date.now() / 1000) - (STALE_CLAIM_SECONDS + 60);
		const id = insertJob(db, {
			kind: 'derivatives',
			status: 'running',
			attempts: MAX_ATTEMPTS,
			payload: { itemId: 'done-for', claimedAt: stale }
		});
		// finalize marks it failed; the reclaim selector no longer picks it up
		expect(claimJob(db, ['derivatives'])).toBeNull();
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
		expect(row.status).toBe('failed');
	});
});

describe('runJob', () => {
	it('marks the job done when the handler succeeds', async () => {
		const db = createTestDb();
		const id = insertJob(db, { kind: 'derivatives', payload: { itemId: 'x' } });
		const job = claimJob(db, ['derivatives'])!;
		const seen: unknown[] = [];
		const outcome = await runJob(
			db,
			job,
			{
				derivatives: async (payload) => {
					seen.push(payload);
				}
			},
			testCtx(db)
		);

		expect(outcome).toBe('done');
		expect(seen).toEqual([{ itemId: 'x' }]);
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
		expect(row.status).toBe('done');
	});

	it('re-pends a failed job with attempts++ and run_after = now + 2^attempts minutes', async () => {
		const db = createTestDb();
		const id = insertJob(db, { kind: 'derivatives' });
		const job = claimJob(db, ['derivatives'])!;
		const before = Date.now();
		const outcome = await runJob(
			db,
			job,
			{
				derivatives: async () => {
					throw new Error('boom');
				}
			},
			testCtx(db)
		);

		expect(outcome).toBe('retry');
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
		expect(row.status).toBe('pending');
		expect(row.attempts).toBe(1);
		const delayMs = row.runAfter.getTime() - before;
		expect(delayMs).toBeGreaterThanOrEqual(2 * 60_000 - 2000);
		expect(delayMs).toBeLessThanOrEqual(2 * 60_000 + 2000);
		expect(JSON.parse(row.payload).lastError).toBe('boom');
	});

	it('fails permanently on the 5th attempt', async () => {
		const db = createTestDb();
		const id = insertJob(db, { kind: 'sprite', attempts: 4 });
		const job = claimJob(db, ['sprite'])!;
		const outcome = await runJob(
			db,
			job,
			{
				sprite: async () => {
					throw new Error('still broken');
				}
			},
			testCtx(db)
		);

		expect(outcome).toBe('failed');
		const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(5);
	});

	it('treats a missing handler as a failure and uses the retry path', async () => {
		const db = createTestDb();
		insertJob(db, { kind: 'derivatives' });
		const job = claimJob(db, ['derivatives'])!;
		const outcome = await runJob(db, job, {}, testCtx(db));
		expect(outcome).toBe('retry');
	});
});

describe('logIngestFailure', () => {
	it('records a failed ingest_scan jobs row with path and reason payload', () => {
		const db = createTestDb();
		logIngestFailure(db, '1994/christmas/corrupt.mp4', 'unrecognized file contents');

		const rows = db.select().from(schema.jobs).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('ingest_scan');
		expect(rows[0].status).toBe('failed');
		expect(rows[0].attempts).toBe(1);
		expect(JSON.parse(rows[0].payload)).toEqual({
			path: '1994/christmas/corrupt.mp4',
			reason: 'unrecognized file contents'
		});
	});
});
