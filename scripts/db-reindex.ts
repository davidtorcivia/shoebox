import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { reindexAll } from '../src/lib/server/search';
import * as schema from '../src/lib/server/db/schema';

const path = process.env.DATABASE_PATH ?? '/data/shoebox.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

const sqlite = new Database(path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });

const started = Date.now();
const count = await reindexAll(db as Parameters<typeof reindexAll>[0]);
console.log(`Reindexed ${count} items in ${path} (${Date.now() - started}ms)`);

sqlite.close();
