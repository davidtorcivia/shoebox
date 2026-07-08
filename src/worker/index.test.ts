import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import { createWorker } from './index';
import type { WorkerContext } from './jobs';
import { createTestDb, insertJob } from './test-helpers';

function testCtx(db: ReturnType<typeof createTestDb>): WorkerContext {
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	return { db, storage: createFsStorage(mediaPath), mediaPath };
}

describe('createWorker polling loop', () => {
	it('backs off while idle, resets after work, and drains on stop', async () => {
		const db = createTestDb();
		const delays: number[] = [];
		const ran: string[] = [];
		const sleep = async (ms: number): Promise<void> => {
			delays.push(ms);
			if (delays.length === 6) insertJob(db, { kind: 'derivatives', payload: { itemId: 'x' } });
			if (delays.length === 8) void worker.stop();
		};

		const worker = createWorker({
			db,
			ctx: testCtx(db),
			handlers: {
				derivatives: async (payload) => {
					ran.push(String(payload.itemId));
				}
			},
			sleep
		});
		await worker.start();

		expect(delays.slice(0, 6)).toEqual([1000, 2000, 3000, 4000, 5000, 5000]);
		expect(ran).toEqual(['x']);
		expect(delays[6]).toBe(1000);
	});

	it('stop waits for the in-flight job to finish', async () => {
		const db = createTestDb();
		insertJob(db, { kind: 'derivatives', payload: { itemId: 'slow' } });
		let finished = false;

		const worker = createWorker({
			db,
			ctx: testCtx(db),
			handlers: {
				derivatives: async () => {
					void worker.stop();
					await new Promise((resolve) => setTimeout(resolve, 50));
					finished = true;
				}
			},
			sleep: async () => {}
		});
		await worker.start();

		expect(finished).toBe(true);
	});
});
