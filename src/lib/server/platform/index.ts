import { env } from '$env/dynamic/private';
import { PLATFORM } from '$env/static/private';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { RequestEvent } from '@sveltejs/kit';
import type { Db } from '../db';
import { openD1Db } from './db-d1';
import { platformFeatures } from './features';
import { noopQueue } from './queue-noop';
import { createR2Storage } from './storage-r2';
import type { Platform } from './types';

type CfBindings = { DB: D1Database; MEDIA: R2Bucket };

let nodeRuntime: { platform: Platform; db: Db } | null = null;

async function initNodeRuntime(): Promise<{ platform: Platform; db: Db }> {
	if (!nodeRuntime) {
		const [{ createFsStorage }, { getNodeDb }, { createSqliteQueue }] = await Promise.all([
			import('./storage-fs'),
			import('./db-node'),
			import('./queue-sqlite')
		]);
		const db = getNodeDb(env.DATABASE_PATH ?? './data/shoebox.db');
		nodeRuntime = {
			db,
			platform: {
				name: 'node',
				storage: createFsStorage(env.MEDIA_PATH ?? './data/media'),
				queue: createSqliteQueue(db),
				features: platformFeatures('node', env)
			}
		};
	}
	return nodeRuntime;
}

function cfRuntime(event: RequestEvent): { platform: Platform; db: Db } {
	const bindings = (event.platform as unknown as { env?: CfBindings } | undefined)?.env;
	if (!bindings?.DB || !bindings?.MEDIA) {
		throw new Error('Cloudflare bindings missing: expected env.DB (D1) and env.MEDIA (R2)');
	}
	return {
		db: openD1Db(bindings.DB),
		platform: {
			name: 'cloudflare',
			storage: createR2Storage(bindings.MEDIA),
			queue: noopQueue,
			features: platformFeatures('cloudflare', {})
		}
	};
}

export async function getPlatform(event: RequestEvent): Promise<Platform> {
	if (PLATFORM === 'cloudflare') return cfRuntime(event).platform;
	return (await initNodeRuntime()).platform;
}

export async function getDb(event: RequestEvent): Promise<Db> {
	if (PLATFORM === 'cloudflare') return cfRuntime(event).db;
	return (await initNodeRuntime()).db;
}
