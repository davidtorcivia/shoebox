import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry'
	},
	webServer: {
		command:
			'ORIGIN=http://127.0.0.1:4173 DATABASE_PATH=./e2e/.data/shoebox.db MEDIA_PATH=./e2e/.data/media PLATFORM=node pnpm build && ORIGIN=http://127.0.0.1:4173 DATABASE_PATH=./e2e/.data/shoebox.db MEDIA_PATH=./e2e/.data/media node build',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
