// Compresses docs/screenshots/*.png to 1600-wide WebP (q85) and removes the
// originals. Photographic screenshots shrink ~5x with no visible loss.
// Run:  node scripts/optimize-shots.mjs
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = 'docs/screenshots';
const pngs = (await readdir(dir)).filter((f) => f.endsWith('.png'));

for (const f of pngs) {
	const src = join(dir, f);
	const dst = join(dir, f.replace(/\.png$/, '.webp'));
	const before = (await stat(src)).size;
	await sharp(src)
		.resize({ width: 1600, withoutEnlargement: true })
		.webp({ quality: 85 })
		.toFile(dst);
	await rm(src);
	const after = (await stat(dst)).size;
	console.log(`${f}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
}
console.log('Done.');
