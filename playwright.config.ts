import { defineConfig } from '@playwright/test';
import { E2E_ENV } from './e2e/env';

export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/global-setup.ts',
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
	expect: { toHaveScreenshot: { threshold: 0.2, animations: 'disabled' } },
	use: {
		baseURL: 'http://localhost:4173'
	},
	webServer: {
		command: 'pnpm build && node build',
		port: 4173,
		reuseExistingServer: false,
		timeout: 240_000,
		env: { ...E2E_ENV, HOST: '127.0.0.1', PORT: '4173' }
	}
});
