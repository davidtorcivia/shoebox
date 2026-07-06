import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = resolve(process.env.DATABASE_PATH ?? './data/shoebox.db');
const migrationsFolder = resolve(process.env.MIGRATIONS_PATH ?? 'src/lib/server/db/migrations');

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

const db = drizzle(sqlite);
migrate(db, { migrationsFolder });

sqlite.close();

console.log(`[migrate] up to date: ${dbPath} (migrations from ${migrationsFolder})`);
