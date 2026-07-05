import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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

const ALL_KINDS: readonly JobKind[] = ['derivatives', 'sprite', 'ingest_scan', 'face_scan'];

export function claimJob(
	db: WorkerDb,
	kinds: JobKind[],
	now: Date = new Date()
): ClaimedJob | null {
	const safeKinds = kinds.filter((kind) => ALL_KINDS.includes(kind));
	if (safeKinds.length === 0) return null;

	const nowSeconds = Math.floor(now.getTime() / 1000);
	const kindList = safeKinds.map((kind) => `'${kind}'`).join(', ');
	const row = db.get<{ id: string; kind: JobKind; payload: string; attempts: number } | undefined>(
		sql.raw(`
			UPDATE jobs SET status = 'running'
			WHERE id = (
				SELECT id FROM jobs
				WHERE status = 'pending' AND run_after <= ${nowSeconds} AND kind IN (${kindList})
				ORDER BY created_at ASC, id ASC
				LIMIT 1
			)
			RETURNING id, kind, payload, attempts
		`)
	);
	if (!row) return null;
	return {
		id: row.id,
		kind: row.kind,
		payload: JSON.parse(row.payload) as Record<string, unknown>,
		attempts: row.attempts
	};
}
