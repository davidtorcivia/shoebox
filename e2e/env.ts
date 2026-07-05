import { join } from 'node:path';

export const E2E_DATA_DIR = join(process.cwd(), 'e2e', '.data');
export const E2E_INGEST_DIR = join(E2E_DATA_DIR, 'ingest');

export const E2E_ENV = {
	PLATFORM: 'node',
	DATABASE_PATH: join(E2E_DATA_DIR, 'shoebox.db'),
	MEDIA_PATH: join(E2E_DATA_DIR, 'media'),
	INGEST_PATH: E2E_INGEST_DIR,
	ORIGIN: 'http://localhost:4173'
} as const;
