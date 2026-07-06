import { defineConfig } from '@playwright/test';

const command = [
	"node -e \"require('fs').rmSync('.wrangler/state',{recursive:true,force:true})\"",
	'pnpm build:cf',
	'pnpm db:migrate:d1',
	'pnpm exec wrangler dev --port 8788'
].join(' && ');

export default defineConfig({
	testDir: 'e2e-cf',
	timeout: 60_000,
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: 'http://127.0.0.1:8788',
		trace: 'on-first-retry'
	},
	webServer: {
		command,
		url: 'http://127.0.0.1:8788/healthz',
		reuseExistingServer: false,
		timeout: 300_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
