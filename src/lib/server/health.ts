import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { faces, items, jobs, people } from './db/schema';
import type { Db } from './db';

export type JobKind = 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan' | 'transcode';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export const JOB_KINDS: JobKind[] = [
	'derivatives',
	'sprite',
	'ingest_scan',
	'face_scan',
	'transcode'
];

export interface JobKindStats {
	kind: JobKind;
	pending: number;
	running: number;
	done: number;
	failed: number;
}

export interface FailedIngest {
	id: string;
	path: string | null;
	reason: string | null;
	createdAt: number;
}

export interface HealthReport {
	generatedAt: number;
	jobs: {
		byKind: JobKindStats[];
		totalPending: number;
		totalRunning: number;
		totalFailed: number;
		oldestPendingAt: number | null;
	};
	failedIngests: {
		count: number;
		recent: FailedIngest[];
	};
	faces: {
		pending: number;
		confirmed: number;
		rejected: number;
		pendingClusters: number;
		lastFaceScanAt: number | null;
	};
	library: {
		readyPhotos: number;
		readyVideos: number;
		needsReview: number;
		trashed: number;
		people: number;
		totalBytes: number;
	};
}

function reasonOf(payload: string): string | null {
	try {
		return (JSON.parse(payload) as { reason?: string }).reason ?? null;
	} catch {
		return null;
	}
}

function pathOf(payload: string): string | null {
	try {
		return (JSON.parse(payload) as { path?: string }).path ?? null;
	} catch {
		return null;
	}
}

export async function loadHealth(db: Db): Promise<HealthReport> {
	// Job queue counts by (kind, status).
	const jobCounts = await db
		.select({ kind: jobs.kind, status: jobs.status, count: sql<number>`count(*)` })
		.from(jobs)
		.groupBy(jobs.kind, jobs.status);

	const byKind: JobKindStats[] = JOB_KINDS.map((kind) => ({
		kind,
		pending: 0,
		running: 0,
		done: 0,
		failed: 0
	}));
	const kindIndex = new Map(byKind.map((row) => [row.kind, row]));
	let totalPending = 0;
	let totalRunning = 0;
	let totalFailed = 0;
	for (const row of jobCounts) {
		const target = kindIndex.get(row.kind as JobKind);
		if (target) target[row.status as JobStatus] = row.count;
		if (row.status === 'pending') totalPending += row.count;
		else if (row.status === 'running') totalRunning += row.count;
		else if (row.status === 'failed') totalFailed += row.count;
	}

	// Oldest pending job (by enqueue time) — a growing age means the worker is
	// falling behind or is down.
	const [oldestPending] = await db
		.select({ createdAt: jobs.createdAt })
		.from(jobs)
		.where(eq(jobs.status, 'pending'))
		.orderBy(jobs.createdAt)
		.limit(1);

	// Failed ingest scans carry { path, reason } payloads.
	const [failedIngestCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(jobs)
		.where(and(eq(jobs.kind, 'ingest_scan'), eq(jobs.status, 'failed')));

	const failedIngestRows = await db
		.select({ id: jobs.id, payload: jobs.payload, createdAt: jobs.createdAt })
		.from(jobs)
		.where(and(eq(jobs.kind, 'ingest_scan'), eq(jobs.status, 'failed')))
		.orderBy(desc(jobs.createdAt))
		.limit(5);

	// Faces.
	const faceCounts = await db
		.select({ status: faces.status, count: sql<number>`count(*)` })
		.from(faces)
		.groupBy(faces.status);
	const faceByStatus: Record<'pending' | 'confirmed' | 'rejected', number> = {
		pending: 0,
		confirmed: 0,
		rejected: 0
	};
	for (const row of faceCounts) {
		faceByStatus[row.status as 'pending' | 'confirmed' | 'rejected'] = row.count;
	}

	const [pendingClusters] = await db
		.select({ count: sql<number>`count(distinct ${faces.clusterId})` })
		.from(faces)
		.where(and(eq(faces.status, 'pending'), isNotNull(faces.clusterId)));

	// Most recent completed face_scan is the best available liveness proxy for the
	// faces worker (GPU/OpenVINO state itself is not observable from here).
	const [lastFaceScan] = await db
		.select({ createdAt: jobs.createdAt })
		.from(jobs)
		.where(and(eq(jobs.kind, 'face_scan'), eq(jobs.status, 'done')))
		.orderBy(desc(jobs.createdAt))
		.limit(1);

	// Library.
	const readyCounts = await db
		.select({
			type: items.type,
			count: sql<number>`count(*)`,
			bytes: sql<number>`sum(${items.sizeBytes})`
		})
		.from(items)
		.where(and(eq(items.status, 'ready'), isNull(items.deletedAt)))
		.groupBy(items.type);
	let readyPhotos = 0;
	let readyVideos = 0;
	let totalBytes = 0;
	for (const row of readyCounts) {
		if (row.type === 'photo') readyPhotos = row.count;
		else if (row.type === 'video') readyVideos = row.count;
		totalBytes += row.bytes ?? 0;
	}

	const [needsReview] = await db
		.select({ count: sql<number>`count(*)` })
		.from(items)
		.where(and(eq(items.status, 'needs_review'), isNull(items.deletedAt)));

	const [trashed] = await db
		.select({ count: sql<number>`count(*)` })
		.from(items)
		.where(isNotNull(items.deletedAt));

	const [peopleCount] = await db.select({ count: sql<number>`count(*)` }).from(people);

	return {
		generatedAt: Date.now(),
		jobs: {
			byKind,
			totalPending,
			totalRunning,
			totalFailed,
			oldestPendingAt: oldestPending ? oldestPending.createdAt.getTime() : null
		},
		failedIngests: {
			count: failedIngestCount?.count ?? 0,
			recent: failedIngestRows.map((row) => ({
				id: row.id,
				path: pathOf(row.payload),
				reason: reasonOf(row.payload),
				createdAt: row.createdAt.getTime()
			}))
		},
		faces: {
			pending: faceByStatus.pending,
			confirmed: faceByStatus.confirmed,
			rejected: faceByStatus.rejected,
			pendingClusters: pendingClusters?.count ?? 0,
			lastFaceScanAt: lastFaceScan ? lastFaceScan.createdAt.getTime() : null
		},
		library: {
			readyPhotos,
			readyVideos,
			needsReview: needsReview?.count ?? 0,
			trashed: trashed?.count ?? 0,
			people: peopleCount?.count ?? 0,
			totalBytes
		}
	};
}
