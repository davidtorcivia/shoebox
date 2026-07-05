import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'src/lib/server/db/migrations';
const statements = readdirSync(MIGRATIONS_DIR)
	.filter((file) => file.endsWith('.sql'))
	.sort()
	.flatMap((file) =>
		readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split('--> statement-breakpoint')
	)
	.map((statement) => statement.trim())
	.filter(Boolean);

export default defineWorkersConfig({
	test: {
		include: ['src/**/*.workers.test.ts'],
		setupFiles: ['src/lib/server/platform/workers-setup.ts'],
		poolOptions: {
			workers: {
				singleWorker: true,
				isolatedStorage: false,
				miniflare: {
					compatibilityDate: '2026-06-01',
					compatibilityFlags: ['nodejs_compat'],
					d1Databases: ['DB'],
					r2Buckets: ['MEDIA'],
					bindings: { TEST_MIGRATIONS: statements }
				}
			}
		}
	}
});
