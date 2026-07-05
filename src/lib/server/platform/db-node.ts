import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from '../db';
import * as schema from '../db/schema';

const MIGRATIONS_FOLDER = 'src/lib/server/db/migrations';

export function openNodeDb(path: string, opts?: { migrationsFolder?: string }): Db {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: opts?.migrationsFolder ?? MIGRATIONS_FOLDER });
	return db as unknown as Db;
}

let singleton: Db | null = null;

export function getNodeDb(path: string): Db {
	if (!singleton) singleton = openNodeDb(path);
	return singleton;
}
