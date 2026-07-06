import Database from 'better-sqlite3';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dbPath = resolve(process.env.DATABASE_PATH ?? '/data/shoebox.db');
const mediaPath = process.env.MEDIA_PATH ?? '/media';

// 30-day soft-delete grace window, as Unix seconds (drizzle timestamp mode).
const cutoff = Math.floor(Date.now() / 1000) - 30 * 86_400;

const db = new Database(dbPath);
// Children are deleted explicitly below, so relax FK enforcement for the sweep.
db.pragma('foreign_keys = OFF');
db.pragma('busy_timeout = 5000');

// 1. Expired soft-deleted comments (counted before the item cascade removes their rows).
const commentSweep = db
	.prepare('DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < ?')
	.run(cutoff);
const commentsPurged = commentSweep.changes;

// 2. Expired soft-deleted items and every child row + media directory.
const expiredItems = db
	.prepare('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?')
	.all(cutoff);

const sweepItem = db.transaction((itemId) => {
	db.prepare('DELETE FROM item_files WHERE item_id = ?').run(itemId);
	db.prepare('DELETE FROM item_people WHERE item_id = ?').run(itemId);
	db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);
	db.prepare('DELETE FROM faces WHERE item_id = ?').run(itemId);
	db.prepare('DELETE FROM comments WHERE item_id = ?').run(itemId);
	db.prepare('DELETE FROM album_items WHERE item_id = ?').run(itemId);
	db.prepare("DELETE FROM shares WHERE target_type = 'item' AND target_id = ?").run(itemId);
	db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
});

	for (const { id } of expiredItems) {
		sweepItem(id);
		try {
			rmSync(join(mediaPath, 'media', id), { recursive: true, force: true });
		} catch (err) {
			console.error(`[trash-sweep] failed to delete media for ${id}: ${err.message}`);
		}
	}

// 3. Expired soft-deleted albums and their children.
const expiredAlbums = db
	.prepare('SELECT id FROM albums WHERE deleted_at IS NOT NULL AND deleted_at < ?')
	.all(cutoff);

const sweepAlbum = db.transaction((albumId) => {
	db.prepare('DELETE FROM album_items WHERE album_id = ?').run(albumId);
	db.prepare("DELETE FROM shares WHERE target_type = 'album' AND target_id = ?").run(albumId);
	db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
});

for (const { id } of expiredAlbums) sweepAlbum(id);

db.close();

// 4. Abandoned chunked-upload tmp trees. completeUpload only cleans up on success;
// uploads that init but never finish (or fail mid-complete) leave tmp/<sha256>/
// {manifest.json, chunks} behind forever. Sweep entries idle past the TTL so disk
// doesn't fill with dead uploads. Node/fs only — the Cloudflare target has no cron.
const tmpRoot = join(mediaPath, 'tmp');
const tmpTtlMs = Number(process.env.UPLOAD_TMP_TTL_HOURS ?? 24) * 3_600_000;
let uploadsSwept = 0;
if (existsSync(tmpRoot) && tmpTtlMs > 0) {
	const tmpCutoff = Date.now() - tmpTtlMs;
	for (const entry of readdirSync(tmpRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) continue;
		const dir = join(tmpRoot, entry.name);
		try {
			if (statSync(dir).mtimeMs < tmpCutoff) {
				rmSync(dir, { recursive: true, force: true });
				uploadsSwept += 1;
			}
		} catch (err) {
			console.error(`[trash-sweep] failed to sweep upload tmp ${entry.name}: ${err.message}`);
		}
	}
}

console.log(
	`[trash-sweep] purged ${expiredItems.length} items, ${commentsPurged} comments, ${expiredAlbums.length} albums, ${uploadsSwept} abandoned uploads`
);
