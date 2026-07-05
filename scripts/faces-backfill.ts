import { backfillFaceScans } from '../src/worker/face-enqueue';
import type { WorkerDb } from '../src/worker/jobs';
import { openNodeDb } from '../src/lib/server/platform/db-node';

const databasePath = process.env.DATABASE_PATH ?? './data/shoebox.db';
const db = openNodeDb(databasePath) as unknown as WorkerDb;
const count = backfillFaceScans(db, process.env);

console.log(`Enqueued ${count} face_scan job${count === 1 ? '' : 's'}.`);
