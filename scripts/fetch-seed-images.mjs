// Downloads beautiful, real photographs for the demo seed.
//   - scenes:  Lorem Picsum (real Unsplash-sourced photos), 1600x1200
//   - faces:   pravatar.cc (real avatar headshots), 800x800
// Idempotent: skips files that already exist with non-trivial size.
// Run:  node scripts/fetch-seed-images.mjs
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'seed-src');
mkdirSync(outDir, { recursive: true });

// seed -> filename. Descriptive seeds so each image is distinct & attractive.
const SCENES = [
	['shoebox-golden-hour', 'scene-01.jpg'],
	['shoebox-morning', 'scene-02.jpg'],
	['shoebox-long-road', 'scene-03.jpg'],
	['shoebox-quiet-hours', 'scene-04.jpg'],
	['shoebox-late-summer', 'scene-05.jpg'],
	['shoebox-westward', 'scene-06.jpg'],
	['shoebox-after-rain', 'scene-07.jpg'],
	['shoebox-first-light', 'scene-08.jpg'],
	['shoebox-festival-night', 'scene-09.jpg'],
	['shoebox-garden-days', 'scene-10.jpg'],
	['shoebox-open-road', 'scene-11.jpg'],
	['shoebox-slow-water', 'scene-12.jpg'],
	['shoebox-tide-pool', 'scene-13.jpg'],
	['shoebox-long-table', 'scene-14.jpg'],
	['shoebox-north-window', 'scene-15.jpg'],
	['shoebox-last-light', 'scene-16.jpg'],
	['shoebox-paper-lanterns', 'scene-17.jpg'],
	['shoebox-hotel-morning', 'scene-18.jpg'],
	['shoebox-boardwalk', 'scene-19.jpg'],
	['shoebox-headland', 'scene-20.jpg'],
	['shoebox-salt-air', 'scene-21.jpg'],
	['shoebox-back-steps', 'scene-22.jpg']
];

// pravatar.cc image ids (1..70) -> filename.
const PORTRAITS = [
	[5, 'portrait-01.jpg'],
	[11, 'portrait-02.jpg'],
	[9, 'portrait-03.jpg'],
	[33, 'portrait-04.jpg'],
	[25, 'portrait-05.jpg'],
	[68, 'portrait-06.jpg']
];

function have(path) {
	return existsSync(path) && statSync(path).size > 5000;
}

async function grab(url, path, label) {
	if (have(path)) {
		console.log(`  ✓ ${label} (cached)`);
		return true;
	}
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			const res = await fetch(url, { redirect: 'follow' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const buf = Buffer.from(await res.arrayBuffer());
			if (buf.length < 5000) throw new Error(`tiny response (${buf.length} bytes)`);
			writeFileSync(path, buf);
			console.log(`  ✓ ${label} (${(buf.length / 1024).toFixed(0)} KB)`);
			return true;
		} catch (err) {
			console.log(`  … ${label} retry ${attempt + 1}: ${err.message}`);
			await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
		}
	}
	console.error(`  ✗ ${label} FAILED`);
	return false;
}

console.log('Fetching demo scenes (Lorem Picsum)…');
let ok = true;
for (const [seed, file] of SCENES) {
	ok = (await grab(`https://picsum.photos/seed/${seed}/1600/1200`, join(outDir, file), file)) && ok;
}

console.log('Fetching portraits (pravatar.cc)…');
for (const [img, file] of PORTRAITS) {
	ok = (await grab(`https://i.pravatar.cc/800?img=${img}`, join(outDir, file), file)) && ok;
}

if (!ok) {
	console.error('\nSome images failed to fetch. Re-run to retry.');
	process.exit(1);
}
console.log('\nAll demo images ready in seed-src/.');
