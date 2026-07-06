import { build } from 'esbuild';
import { resolve } from 'node:path';

await build({
	entryPoints: ['src/worker/index.ts'],
	outfile: 'build-worker/index.js',
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	sourcemap: true,
	// Native/optional deps must stay external so the runtime resolves them.
	external: ['sharp', 'ffmpeg-static', 'ffprobe-static', 'better-sqlite3'],
	// src/lib/server/** imports through the `$lib` alias; map it to the source tree.
	alias: { $lib: resolve('src/lib') },
	// Bundled CJS deps (fluent-ffmpeg, ffprobe-static, drizzle) use `require`,
	// `__dirname`, and `__filename`, none of which exist in ESM. Define all three.
	banner: {
		js: [
			"import { createRequire as sbCreateRequire } from 'node:module';",
			"import { fileURLToPath as sbFileURLToPath } from 'node:url';",
			"import { dirname as sbDirname } from 'node:path';",
			'const require = sbCreateRequire(import.meta.url);',
			'const __filename = sbFileURLToPath(import.meta.url);',
			'const __dirname = sbDirname(__filename);'
		].join('\n')
	},
	logLevel: 'info'
});

console.log('[build-worker] wrote build-worker/index.js');
