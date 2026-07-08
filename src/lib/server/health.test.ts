import { describe, expect, it } from 'vitest';
import { createTestDb, insertJob, seedItem, seedOwner } from '../../worker/test-helpers';
import * as schema from './db/schema';
import { loadHealth } from './health';
import type { Db } from './db';

const NOW = Date.now();
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

function setup() {
	const db = createTestDb();
	const owner = seedOwner(db);
	return { db, owner };
}

describe('loadHealth', () => {
	it('rolls up job counts by kind and status', async () => {
		const { db } = setup();
		insertJob(db, { kind: 'derivatives', status: 'pending' });
		insertJob(db, { kind: 'derivatives', status: 'pending' });
		insertJob(db, { kind: 'derivatives', status: 'failed' });
		insertJob(db, { kind: 'sprite', status: 'running' });
		insertJob(db, { kind: 'face_scan', status: 'done' });

		const report = await loadHealth(db as unknown as Db);

		expect(report.jobs.totalPending).toBe(2);
		expect(report.jobs.totalRunning).toBe(1);
		expect(report.jobs.totalFailed).toBe(1);

		const deriv = report.jobs.byKind.find((r) => r.kind === 'derivatives')!;
		expect(deriv).toMatchObject({ pending: 2, running: 0, done: 0, failed: 1 });
		// Every kind is always represented, even with zero jobs.
		expect(report.jobs.byKind.map((r) => r.kind)).toEqual([
			'derivatives',
			'sprite',
			'ingest_scan',
			'face_scan',
			'transcode'
		]);
	});

	it('reports the oldest pending job time', async () => {
		const { db } = setup();
		insertJob(db, { kind: 'derivatives', status: 'pending', createdAt: minsAgo(30) });
		insertJob(db, { kind: 'sprite', status: 'pending', createdAt: minsAgo(5) });
		// A failed job that is older must not count as the oldest *pending*.
		insertJob(db, { kind: 'transcode', status: 'failed', createdAt: minsAgo(120) });

		const report = await loadHealth(db as unknown as Db);
		expect(report.jobs.oldestPendingAt).toBe(minsAgo(30).getTime());
	});

	it('surfaces failed ingest reasons and paths, newest first', async () => {
		const { db } = setup();
		insertJob(db, {
			kind: 'ingest_scan',
			status: 'failed',
			payload: { path: '/media/old.mov', reason: 'unreadable' },
			createdAt: minsAgo(60)
		});
		insertJob(db, {
			kind: 'ingest_scan',
			status: 'failed',
			payload: { path: '/media/new.mov', reason: 'bad codec' },
			createdAt: minsAgo(1)
		});
		insertJob(db, { kind: 'ingest_scan', status: 'done', payload: { path: '/media/ok.mov' } });

		const report = await loadHealth(db as unknown as Db);
		expect(report.failedIngests.count).toBe(2);
		expect(report.failedIngests.recent[0]).toMatchObject({
			path: '/media/new.mov',
			reason: 'bad codec'
		});
		expect(report.failedIngests.recent[1].reason).toBe('unreadable');
	});

	it('counts faces by status, pending clusters, and last completed scan', async () => {
		const { db, owner } = setup();
		const itemId = seedItem(db, owner, { type: 'photo', status: 'ready' });
		const embedding = Buffer.from([1, 2, 3, 4]);
		db.insert(schema.faces)
			.values([
				{ id: 'f1', itemId, box: '{}', embedding, clusterId: 'c1', status: 'pending' },
				{ id: 'f2', itemId, box: '{}', embedding, clusterId: 'c1', status: 'pending' },
				{ id: 'f3', itemId, box: '{}', embedding, clusterId: 'c2', status: 'pending' },
				{ id: 'f4', itemId, box: '{}', embedding, clusterId: null, status: 'pending' },
				{ id: 'f5', itemId, box: '{}', embedding, clusterId: 'c1', status: 'confirmed' },
				{ id: 'f6', itemId, box: '{}', embedding, clusterId: 'c3', status: 'rejected' }
			])
			.run();
		insertJob(db, { kind: 'face_scan', status: 'done', createdAt: minsAgo(90) });
		insertJob(db, { kind: 'face_scan', status: 'done', createdAt: minsAgo(15) });
		insertJob(db, { kind: 'face_scan', status: 'pending', createdAt: minsAgo(1) });

		const report = await loadHealth(db as unknown as Db);
		expect(report.faces.pending).toBe(4);
		expect(report.faces.confirmed).toBe(1);
		expect(report.faces.rejected).toBe(1);
		// Distinct non-null cluster ids among pending faces: c1, c2.
		expect(report.faces.pendingClusters).toBe(2);
		// Most recent *completed* scan wins over the pending one.
		expect(report.faces.lastFaceScanAt).toBe(minsAgo(15).getTime());
	});

	it('summarizes the library, excluding trashed and unreviewed from ready counts', async () => {
		const { db, owner } = setup();
		seedItem(db, owner, { type: 'photo', status: 'ready', sizeBytes: 1000 });
		seedItem(db, owner, { type: 'photo', status: 'ready', sizeBytes: 2000 });
		seedItem(db, owner, { type: 'video', status: 'ready', sizeBytes: 5000 });
		seedItem(db, owner, { type: 'photo', status: 'needs_review', sizeBytes: 999 });
		seedItem(db, owner, {
			type: 'photo',
			status: 'ready',
			sizeBytes: 4000,
			deletedAt: new Date()
		});
		db.insert(schema.people)
			.values({ id: 'p1', name: 'Mom', slug: 'mom', accentColor: '#FA7B62', createdAt: new Date() })
			.run();

		const report = await loadHealth(db as unknown as Db);
		expect(report.library.readyPhotos).toBe(2);
		expect(report.library.readyVideos).toBe(1);
		expect(report.library.needsReview).toBe(1);
		expect(report.library.trashed).toBe(1);
		expect(report.library.people).toBe(1);
		// Only ready, non-deleted items count toward stored bytes.
		expect(report.library.totalBytes).toBe(1000 + 2000 + 5000);
	});

	it('returns empty-but-valid data for a fresh db', async () => {
		const { db } = setup();
		const report = await loadHealth(db as unknown as Db);
		expect(report.jobs.totalPending).toBe(0);
		expect(report.jobs.oldestPendingAt).toBeNull();
		expect(report.failedIngests.count).toBe(0);
		expect(report.faces.lastFaceScanAt).toBeNull();
		expect(report.library.totalBytes).toBe(0);
	});
});
