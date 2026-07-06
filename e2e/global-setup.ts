import { mkdirSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { E2E_DATA_DIR, E2E_INGEST_DIR } from './env';
import { generateFixtures } from './fixtures/generate';

// Best-effort recursive delete: on Windows the previous run's worker can hold
// the SQLite WAL handles briefly. Retry so a fresh run starts clean; on CI the
// directory is absent and this is a single no-op.
async function cleanDir(dir: string): Promise<void> {
	for (let attempt = 0; attempt < 15; attempt += 1) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			await delay(1000);
		}
	}
}

export default async function globalSetup(): Promise<void> {
	await cleanDir(E2E_DATA_DIR);
	mkdirSync(E2E_INGEST_DIR, { recursive: true });
	await generateFixtures();
}
