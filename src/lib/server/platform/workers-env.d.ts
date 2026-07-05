/// <reference types="@cloudflare/vitest-pool-workers" />
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare module 'cloudflare:test' {
	interface ProvidedEnv {
		DB: D1Database;
		MEDIA: R2Bucket;
		TEST_MIGRATIONS: string[];
	}
}
