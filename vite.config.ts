import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		// Native module: external in node builds and unreachable in cloudflare builds.
		external: ['better-sqlite3']
	},
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['src/**/*.workers.test.ts', 'node_modules/**'],
		environment: 'node'
	}
});
