// One-shot: compute frame_phash for every item that lacks one (mid-point frame
// for videos, the image itself for photos). Run on the host:
//   MEDIA_PATH=<media dir> DATABASE_PATH=./data/shoebox.db pnpm tsx scripts/backfill-phash.ts
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';
import { openNodeDb } from '../src/lib/server/platform/db-node';
import type { WorkerDb } from '../src/worker/jobs';
import { imagePhash, videoFramePhash } from '../src/worker/phash';

const databasePath = process.env.DATABASE_PATH ?? './data/shoebox.db';
const mediaPath = process.env.MEDIA_PATH;
if (!mediaPath) throw new Error('MEDIA_PATH is required');

const db = openNodeDb(databasePath) as unknown as WorkerDb;
const rows = db
	.select({
		id: schema.items.id,
		type: schema.items.type,
		duration: schema.items.duration,
		storageKey: schema.itemFiles.storageKey
	})
	.from(schema.items)
	.innerJoin(
		schema.itemFiles,
		and(eq(schema.itemFiles.itemId, schema.items.id), eq(schema.itemFiles.kind, 'original'))
	)
	.where(isNull(schema.items.framePhash))
	.all();

let filled = 0;
for (const row of rows) {
	try {
		const abs = join(mediaPath, row.storageKey);
		const phash =
			row.type === 'video'
				? await videoFramePhash(abs, (row.duration ?? 0) / 2)
				: await imagePhash(abs);
		db.update(schema.items).set({ framePhash: phash }).where(eq(schema.items.id, row.id)).run();
		filled += 1;
	} catch (err) {
		console.error(`phash failed for ${row.id}: ${err}`);
	}
}
console.log(`Filled frame_phash on ${filled}/${rows.length} items.`);
