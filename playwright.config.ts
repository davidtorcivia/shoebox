import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://localhost:4173'
	},
	webServer: {
		command:
			'rm -rf e2e/.data && mkdir -p e2e/.data && pnpm build && DATABASE_PATH=e2e/.data/shoebox.db MEDIA_PATH=e2e/.data/media HOST=127.0.0.1 PORT=4173 ORIGIN=http://localhost:4173 node build',
		port: 4173,
		reuseExistingServer: false,
		timeout: 180_000
	}
});
