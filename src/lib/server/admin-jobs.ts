import { and, desc, eq, inArray } from 'drizzle-orm';
import { jobs } from './db/schema';
import type { Db } from './db';

export interface JobRow {
	id: string;
	kind: 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan' | 'transcode' | 'hls';
	payload: string;
	status: 'pending' | 'running' | 'done' | 'failed';
	attempts: number;
	runAfter: Date;
	createdAt: Date;
}

export async function listJobs(db: Db): Promise<JobRow[]> {
	return db
		.select()
		.from(jobs)
		.where(inArray(jobs.status, ['pending', 'running', 'failed']))
		.orderBy(desc(jobs.createdAt))
		.limit(200);
}

export async function retryJob(db: Db, id: string): Promise<boolean> {
	const found = await db
		.select({ id: jobs.id })
		.from(jobs)
		.where(and(eq(jobs.id, id), eq(jobs.status, 'failed')))
		.limit(1);
	if (found.length === 0) return false;
	await db.update(jobs).set({ status: 'pending', runAfter: new Date() }).where(eq(jobs.id, id));
	return true;
}
