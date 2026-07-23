// One-shot: probe every video's creation_time and fill items.capture_time where
// it is still null (never overwrites a manual value). Run on the host:
//   MEDIA_PATH=<media dir> DATABASE_PATH=./data/shoebox.db pnpm tsx scripts/backfill-capture-time.ts
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';
import { openNodeDb } from '../src/lib/server/platform/db-node';
import type { WorkerDb } from '../src/worker/jobs';
import { probeVideo } from '../src/worker/derivatives';

const databasePath = process.env.DATABASE_PATH ?? './data/shoebox.db';
const mediaPath = process.env.MEDIA_PATH;
if (!mediaPath) throw new Error('MEDIA_PATH is required');

const db = openNodeDb(databasePath) as unknown as WorkerDb;
const rows = db
	.select({ id: schema.items.id, storageKey: schema.itemFiles.storageKey })
	.from(schema.items)
	.innerJoin(
		schema.itemFiles,
		and(eq(schema.itemFiles.itemId, schema.items.id), eq(schema.itemFiles.kind, 'original'))
	)
	.where(and(eq(schema.items.type, 'video'), isNull(schema.items.captureTime)))
	.all();

let filled = 0;
for (const row of rows) {
	try {
		const probe = await probeVideo(join(mediaPath, row.storageKey));
		if (!probe.creationTimestamp) continue;
		db.update(schema.items)
			.set({ captureTime: probe.creationTimestamp })
			.where(eq(schema.items.id, row.id))
			.run();
		filled += 1;
	} catch (err) {
		console.error(`probe failed for ${row.id}: ${err}`);
	}
}
console.log(`Filled capture_time on ${filled}/${rows.length} videos.`);
