import { nanoid } from 'nanoid';
import type { Db } from '../db';
import { jobs } from '../db/schema';
import type { JobQueueAdapter } from './types';

export function createSqliteQueue(db: Db): JobQueueAdapter {
	return {
		async enqueue(kind, payload, runAfter = new Date()) {
			await db.insert(jobs).values({
				id: nanoid(12),
				kind,
				payload: JSON.stringify(payload),
				status: 'pending',
				attempts: 0,
				runAfter,
				createdAt: new Date()
			});
		}
	};
}
