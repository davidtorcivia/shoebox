import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		include: ['src/**/*.workers.test.ts'],
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.toml' }
			}
		}
	}
});
