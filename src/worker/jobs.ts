import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema';
import type { StorageAdapter } from '../lib/server/platform/types';

export type WorkerDb = BetterSQLite3Database<typeof schema>;
export type JobKind = 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan';

export interface ClaimedJob {
	id: string;
	kind: JobKind;
	payload: Record<string, unknown>;
	attempts: number;
}

export interface WorkerContext {
	db: WorkerDb;
	storage: StorageAdapter;
	mediaPath: string;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: WorkerContext) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export const MAX_ATTEMPTS = 5;

/** A claimed job is considered stuck (and reclaimed) once it has been
 * 'running' longer than this. Bounds recovery from worker crashes mid-job. */
export const STALE_CLAIM_SECONDS = 15 * 60;

const ALL_KINDS: readonly JobKind[] = ['derivatives', 'sprite', 'ingest_scan', 'face_scan'];

export function claimJob(
	db: WorkerDb,
	kinds: JobKind[],
	now: Date = new Date()
): ClaimedJob | null {
	const safeKinds = kinds.filter((kind) => ALL_KINDS.includes(kind));
	if (safeKinds.length === 0) return null;

	const nowSeconds = Math.floor(now.getTime() / 1000);
	const staleBefore = nowSeconds - STALE_CLAIM_SECONDS;
	const kindList = safeKinds.map((kind) => `'${kind}'`).join(', ');

	// A job that crashed its worker mid-run stays 'running'. Once it has burned
	// through all retries in that state it cannot make progress, so fail it now
	// instead of reclaiming it forever. Skipped entirely when nothing is running
	// so the idle poll loop does not contend for the write lock.
	const stuck = db
		.get<{ id: string } | undefined>(
			sql.raw(`
				SELECT id FROM jobs
				WHERE kind IN (${kindList}) AND status = 'running' AND attempts >= ${MAX_ATTEMPTS}
				LIMIT 1
			`)
		);
	if (stuck) {
		db.run(
			sql.raw(`
				UPDATE jobs SET status = 'failed'
				WHERE kind IN (${kindList})
					AND status = 'running'
					AND attempts >= ${MAX_ATTEMPTS}
					AND (
						json_extract(payload, '$.claimedAt') IS NULL
						OR CAST(json_extract(payload, '$.claimedAt') AS INTEGER) <= ${staleBefore}
					)
			`)
		);
	}

	// Atomic compare-and-set: the inner SELECT and outer UPDATE run under a
	// single SQLite write lock, so two workers can never claim the same row.
	// A 'running' row older than the stale threshold is reclaimed (counted as a
	// fresh attempt) to recover from a worker that died holding the job.
	const row = db.get<{ id: string; kind: JobKind; payload: string; attempts: number } | undefined>(
		sql.raw(`
			UPDATE jobs
			SET status = 'running',
				attempts = CASE WHEN status = 'running' THEN attempts + 1 ELSE attempts END,
				payload = json_set(payload, '$.claimedAt', ${nowSeconds})
			WHERE id = (
				SELECT id FROM jobs
				WHERE kind IN (${kindList})
					AND (
						(status = 'pending' AND run_after <= ${nowSeconds})
						OR (
							status = 'running'
							AND attempts < ${MAX_ATTEMPTS}
							AND (
								json_extract(payload, '$.claimedAt') IS NULL
								OR CAST(json_extract(payload, '$.claimedAt') AS INTEGER) <= ${staleBefore}
							)
						)
					)
				ORDER BY created_at ASC, id ASC
				LIMIT 1
			)
			RETURNING id, kind, payload, attempts
		`)
	);
	if (!row) return null;
	const payload = JSON.parse(row.payload) as Record<string, unknown>;
	// claimedAt is operational bookkeeping; keep it out of the handler payload.
	delete payload.claimedAt;
	return {
		id: row.id,
		kind: row.kind,
		payload,
		attempts: row.attempts
	};
}

export async function runJob(
	db: WorkerDb,
	job: ClaimedJob,
	handlers: JobHandlers,
	ctx: WorkerContext
): Promise<'done' | 'retry' | 'failed'> {
	try {
		const handler = handlers[job.kind];
		if (!handler) throw new Error(`no handler registered for kind '${job.kind}'`);
		await handler(job.payload, ctx);
		db.update(schema.jobs).set({ status: 'done' }).where(eq(schema.jobs.id, job.id)).run();
		return 'done';
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		const attempts = job.attempts + 1;
		const payload = JSON.stringify({ ...job.payload, lastError: reason });

		if (attempts >= MAX_ATTEMPTS) {
			db.update(schema.jobs)
				.set({ status: 'failed', attempts, payload })
				.where(eq(schema.jobs.id, job.id))
				.run();
			return 'failed';
		}

		const runAfter = new Date(Date.now() + 2 ** attempts * 60_000);
		db.update(schema.jobs)
			.set({ status: 'pending', attempts, payload, runAfter })
			.where(eq(schema.jobs.id, job.id))
			.run();
		return 'retry';
	}
}

export function logIngestFailure(db: WorkerDb, path: string, reason: string): void {
	db.insert(schema.jobs)
		.values({
			id: nanoid(12),
			kind: 'ingest_scan',
			payload: JSON.stringify({ path, reason }),
			status: 'failed',
			attempts: 1,
			runAfter: new Date(),
			createdAt: new Date()
		})
		.run();
}
