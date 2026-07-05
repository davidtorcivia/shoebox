import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import * as schema from '../lib/server/db/schema';
import { openNodeDb } from '../lib/server/platform/db-node';
import { createSqliteQueue } from '../lib/server/platform/queue-sqlite';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import { derivativesHandler, spriteHandler } from './derivatives';
import {
	claimJob,
	runJob,
	type JobHandlers,
	type JobKind,
	type WorkerContext,
	type WorkerDb
} from './jobs';

const HANDLED_KINDS: JobKind[] = ['derivatives', 'sprite'];

interface IngestWatcher {
	close(): Promise<void>;
}

export interface WorkerHandle {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export function createWorker(opts: {
	db: WorkerDb;
	ctx: WorkerContext;
	handlers: JobHandlers;
	kinds?: JobKind[];
	idleMinMs?: number;
	idleMaxMs?: number;
	sleep?: (ms: number) => Promise<void>;
}): WorkerHandle {
	const kinds = opts.kinds ?? HANDLED_KINDS;
	const idleMin = opts.idleMinMs ?? 1000;
	const idleMax = opts.idleMaxMs ?? 5000;
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let stopping = false;
	let loop: Promise<void> | null = null;

	async function run(): Promise<void> {
		let idle = idleMin;
		while (!stopping) {
			const job = claimJob(opts.db, kinds);
			if (!job) {
				await sleep(idle);
				idle = Math.min(idle + idleMin, idleMax);
				continue;
			}

			idle = idleMin;
			const outcome = await runJob(opts.db, job, opts.handlers, opts.ctx);
			console.log(`[worker] job ${job.id} (${job.kind}) -> ${outcome}`);
		}
	}

	return {
		start(): Promise<void> {
			loop = run();
			return loop;
		},
		async stop(): Promise<void> {
			stopping = true;
			if (loop) await loop;
		}
	};
}

async function waitForOwner(db: WorkerDb): Promise<string> {
	for (;;) {
		const owner = db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.role, 'owner'))
			.get();
		if (owner) return owner.id;
		console.log('[worker] no owner yet, waiting for first-run setup');
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
}

async function main(): Promise<void> {
	const databasePath = process.env.DATABASE_PATH ?? '/data/shoebox.db';
	const mediaPath = process.env.MEDIA_PATH ?? '/data/media';
	const ingestPath = process.env.INGEST_PATH;
	const db = openNodeDb(databasePath) as unknown as WorkerDb;
	const storage = createFsStorage(mediaPath);
	const ctx: WorkerContext = { db, storage, mediaPath };
	const queue = createSqliteQueue(db);
	const handlers: JobHandlers = {
		derivatives: derivativesHandler,
		sprite: spriteHandler
	};
	const worker = createWorker({ db, ctx, handlers });
	let watcher = null as IngestWatcher | null;

	if (ingestPath) {
		const ownerId = await waitForOwner(db);
		console.log(`[worker] ingestion watcher on ${ingestPath}`);
		void queue;
		void ownerId;
	}

	const shutdown = async (signal: string): Promise<void> => {
		console.log(`[worker] ${signal} received, draining`);
		if (watcher) await watcher.close();
		await worker.stop();
		process.exit(0);
	};

	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('SIGINT', () => void shutdown('SIGINT'));

	console.log(
		`[worker] started (db=${databasePath}, media=${mediaPath}, ingest=${ingestPath ?? 'disabled'})`
	);
	await worker.start();
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error('[worker] fatal', err);
		process.exit(1);
	});
}
