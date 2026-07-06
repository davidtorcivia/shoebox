import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from '../db';
import * as schema from '../db/schema';

const DEFAULT_MIGRATIONS_FOLDER = 'src/lib/server/db/migrations';

export function openNodeDb(path: string, opts?: { migrationsFolder?: string }): Db {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	// WAL: readers never block the writer; multiple connections (app + worker
	// process) coexist. synchronous=NORMAL is the SQLite-recommended pairing
	// for WAL — crash-safe (no corruption), only the last txn may be lost on a
	// power cut, and it avoids an fsync per commit.
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('synchronous = NORMAL');
	// busy_timeout: when the app and the worker (separate process) both write,
	// SQLite retries a BUSY write for this long before throwing SQLITE_BUSY.
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	const migrationsFolder =
		opts?.migrationsFolder ?? process.env.MIGRATIONS_PATH ?? DEFAULT_MIGRATIONS_FOLDER;
	migrate(db, { migrationsFolder });
	return db as unknown as Db;
}

let singleton: Db | null = null;

export function getNodeDb(path: string): Db {
	if (!singleton) singleton = openNodeDb(path);
	return singleton;
}
