import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema';
import type { JobKind, WorkerDb } from './jobs';

export function createTestDb(): WorkerDb {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
	return db;
}

export function seedOwner(db: WorkerDb): string {
	const id = nanoid(12);
	db.insert(schema.users)
		.values({
			id,
			username: `owner-${id}`,
			passwordHash: 'pbkdf2$310000$test$test',
			role: 'owner',
			accentColor: '#FA7B62',
			createdAt: new Date()
		})
		.run();
	return id;
}

export function seedItem(
	db: WorkerDb,
	ownerId: string,
	overrides: Partial<typeof schema.items.$inferInsert> = {}
): string {
	const id = nanoid(12);
	db.insert(schema.items)
		.values({
			id,
			type: 'video',
			datePrecision: 'unknown',
			width: 320,
			height: 180,
			sizeBytes: 1,
			sha256: `sha-${id}`,
			source: 'upload',
			status: 'processing',
			uploadedBy: ownerId,
			createdAt: new Date(),
			...overrides
		})
		.run();
	return id;
}

export function insertJob(
	db: WorkerDb,
	partial: {
		kind: JobKind;
		payload?: Record<string, unknown>;
		status?: 'pending' | 'running' | 'done' | 'failed';
		attempts?: number;
		runAfter?: Date;
		createdAt?: Date;
	}
): string {
	const id = nanoid(12);
	db.insert(schema.jobs)
		.values({
			id,
			kind: partial.kind,
			payload: JSON.stringify(partial.payload ?? {}),
			status: partial.status ?? 'pending',
			attempts: partial.attempts ?? 0,
			runAfter: partial.runAfter ?? new Date(0),
			createdAt: partial.createdAt ?? new Date()
		})
		.run();
	return id;
}
