import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dbPath = resolve(process.env.DATABASE_PATH ?? '/data/shoebox.db');
const destDir = resolve(process.argv[2] ?? '/data/backups');
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
if (!Number.isFinite(keepDays) || keepDays < 0) {
	throw new Error(`BACKUP_KEEP_DAYS must be a non-negative number, got: ${process.env.BACKUP_KEEP_DAYS}`);
}

mkdirSync(destDir, { recursive: true });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const name = `shoebox-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(
	now.getHours()
)}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.db`;
const dest = join(destDir, name);

const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 5000');
await db.backup(dest);
db.close();
console.log(`[backup] wrote ${dest}`);

// Prune backups older than the keep window.
const cutoff = Date.now() - keepDays * 86_400_000;
for (const file of readdirSync(destDir)) {
	if (!/^shoebox-.*\.db(?:-wal|-shm)?$/.test(file)) continue;
	const full = join(destDir, file);
	if (statSync(full).mtimeMs < cutoff) {
		unlinkSync(full);
		console.log(`[backup] pruned ${full}`);
	}
}
