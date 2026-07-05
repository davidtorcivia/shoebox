import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import {
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { GET } from './+server';
import { POST } from './[id]/retry/+server';

let db: TestDb;
const NOW = new Date('2026-07-05T12:00:00Z');

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, id = 'j_failed') {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request('http://test/api/admin/jobs', { method: 'GET' })
	} as never;
}

async function seedJobs(): Promise<void> {
	await db.insert(schema.jobs).values([
		{
			id: 'j_failed',
			kind: 'derivatives',
			payload: '{"reason":"bad source"}',
			status: 'failed',
			attempts: 2,
			runAfter: NOW,
			createdAt: NOW
		},
		{
			id: 'j_done',
			kind: 'sprite',
			payload: '{}',
			status: 'done',
			attempts: 1,
			runAfter: NOW,
			createdAt: NOW
		}
	]);
}

describe('GET /api/admin/jobs', () => {
	it('requires admin and lists active jobs', async () => {
		await seedJobs();
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(GET(evt(editor))).rejects.toMatchObject({ status: 403 });

		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const res = await GET(evt(admin));
		const body = await res.json();
		expect(body.jobs.map((job: { id: string }) => job.id)).toEqual(['j_failed']);
	});
});

describe('POST /api/admin/jobs/[id]/retry', () => {
	it('retries failed jobs', async () => {
		await seedJobs();
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const res = await POST(evt(admin));
		expect(await res.json()).toEqual({ retried: true });
		const row = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_failed')))[0];
		expect(row.status).toBe('pending');
	});
});
