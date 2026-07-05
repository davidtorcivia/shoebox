import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '../lib/server/db/schema';
import { claimJob } from './jobs';
import { createTestDb, insertJob } from './test-helpers';

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
