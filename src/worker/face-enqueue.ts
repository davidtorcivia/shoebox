import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema';
import { facesEnabled } from '../lib/server/platform/features';
import type { JobHandler, WorkerDb } from './jobs';

type FaceEnv = Record<string, string | undefined> & { FACES_ENABLED?: string };

function activeFaceScanExists(db: WorkerDb, itemId: string): boolean {
	const rows = db
		.select({ payload: schema.jobs.payload })
		.from(schema.jobs)
		.where(and(eq(schema.jobs.kind, 'face_scan'), eq(schema.jobs.status, 'pending')))
		.all()
		.concat(
			db
				.select({ payload: schema.jobs.payload })
				.from(schema.jobs)
				.where(and(eq(schema.jobs.kind, 'face_scan'), eq(schema.jobs.status, 'running')))
				.all()
		);

	return rows.some((row) => {
		try {
			return (JSON.parse(row.payload) as { itemId?: unknown }).itemId === itemId;
		} catch {
			return false;
		}
	});
}

export function maybeEnqueueFaceScan(db: WorkerDb, itemId: string, env: FaceEnv): boolean {
	if (!facesEnabled(env)) return false;
	if (!itemId || activeFaceScanExists(db, itemId)) return false;

	db.insert(schema.jobs)
		.values({
			id: nanoid(12),
			kind: 'face_scan',
			payload: JSON.stringify({ itemId }),
			status: 'pending',
			attempts: 0,
			runAfter: new Date(),
			createdAt: new Date()
		})
		.run();
	return true;
}

export function withFaceScanAfterDerivatives(handler: JobHandler, env: FaceEnv): JobHandler {
	return async (payload, ctx) => {
		await handler(payload, ctx);
		// A poster-only regeneration doesn't change the frames, so there's nothing
		// new to detect — skip the (expensive) face re-scan.
		if (payload.skipFaceScan) return;
		maybeEnqueueFaceScan(ctx.db, String(payload.itemId ?? ''), env);
	};
}

export function backfillFaceScans(db: WorkerDb, env: FaceEnv): number {
	if (!facesEnabled(env)) return 0;

	const rows = db
		.select({ id: schema.items.id })
		.from(schema.items)
		.where(and(eq(schema.items.status, 'ready'), isNull(schema.items.deletedAt)))
		.all();

	let count = 0;
	for (const row of rows) {
		if (maybeEnqueueFaceScan(db, row.id, env)) count += 1;
	}
	return count;
}
