import { mkdirSync, rmSync } from 'node:fs';
import { E2E_DATA_DIR, E2E_INGEST_DIR } from './env';
import { generateFixtures } from './fixtures/generate';

export default async function globalSetup(): Promise<void> {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_INGEST_DIR, { recursive: true });
	await generateFixtures();
}
