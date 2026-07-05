import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '../lib/server/db/schema';
import type { JobHandler } from './jobs';
import {
	backfillFaceScans,
	maybeEnqueueFaceScan,
	withFaceScanAfterDerivatives
} from './face-enqueue';
import { createTestDb, insertJob, seedItem, seedOwner } from './test-helpers';

function faceScanJobs(db: ReturnType<typeof createTestDb>) {
	return db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'face_scan')).all();
}

describe('maybeEnqueueFaceScan', () => {
	it('does nothing when FACES_ENABLED is not 1', () => {
		const db = createTestDb();
		expect(maybeEnqueueFaceScan(db, 'it1', { FACES_ENABLED: '0' })).toBe(false);
		expect(faceScanJobs(db)).toHaveLength(0);
	});

	it('enqueues a face_scan job when enabled', () => {
		const db = createTestDb();
		expect(maybeEnqueueFaceScan(db, 'it1', { FACES_ENABLED: '1' })).toBe(true);
		const jobs = faceScanJobs(db);
		expect(jobs).toHaveLength(1);
		expect(JSON.parse(jobs[0].payload)).toEqual({ itemId: 'it1' });
	});

	it('avoids duplicate pending or running jobs for the same item', () => {
		const db = createTestDb();
		insertJob(db, { kind: 'face_scan', payload: { itemId: 'it1' }, status: 'pending' });
		expect(maybeEnqueueFaceScan(db, 'it1', { FACES_ENABLED: '1' })).toBe(false);
		expect(faceScanJobs(db)).toHaveLength(1);

		insertJob(db, { kind: 'face_scan', payload: { itemId: 'it2' }, status: 'running' });
		expect(maybeEnqueueFaceScan(db, 'it2', { FACES_ENABLED: '1' })).toBe(false);
		expect(faceScanJobs(db)).toHaveLength(2);
	});
});

describe('withFaceScanAfterDerivatives', () => {
	it('enqueues only after the wrapped derivatives handler succeeds', async () => {
		const db = createTestDb();
		const handler: JobHandler = async () => undefined;
		const wrapped = withFaceScanAfterDerivatives(handler, { FACES_ENABLED: '1' });

		await wrapped({ itemId: 'it1' }, { db, storage: null as never, mediaPath: '/tmp' });

		expect(faceScanJobs(db)).toHaveLength(1);
	});

	it('does not enqueue when the wrapped derivatives handler fails', async () => {
		const db = createTestDb();
		const handler: JobHandler = async () => {
			throw new Error('derivatives failed');
		};
		const wrapped = withFaceScanAfterDerivatives(handler, { FACES_ENABLED: '1' });

		await expect(
			wrapped({ itemId: 'it1' }, { db, storage: null as never, mediaPath: '/tmp' })
		).rejects.toThrow(/derivatives failed/);
		expect(faceScanJobs(db)).toHaveLength(0);
	});
});

describe('backfillFaceScans', () => {
	it('enqueues missing face scans for ready, non-deleted items', () => {
		const db = createTestDb();
		const ownerId = seedOwner(db);
		const ready = seedItem(db, ownerId, { status: 'ready' });
		seedItem(db, ownerId, { status: 'processing' });
		seedItem(db, ownerId, { status: 'ready', deletedAt: new Date() });
		insertJob(db, { kind: 'face_scan', payload: { itemId: ready }, status: 'done' });

		expect(backfillFaceScans(db, { FACES_ENABLED: '1' })).toBe(1);
		expect(
			db
				.select()
				.from(schema.jobs)
				.where(and(eq(schema.jobs.kind, 'face_scan'), eq(schema.jobs.status, 'pending')))
				.all()
		).toHaveLength(1);
	});
});
