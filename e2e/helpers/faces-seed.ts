import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = 'e2e/.data/shoebox.db';
const MEDIA_ROOT = 'e2e/.data/media';
const WEBP_1PX = Buffer.from(
	'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
	'base64'
);
const EMB = Buffer.alloc(2048);

export interface FacesSeed {
	itemId: string;
	personId: string;
	personSlug: string;
	clusterId: string;
}

export function seedFaces(): FacesSeed {
	const db = new Database(DB_PATH);
	const owner = db.prepare('select id from users where username = ?').get('matriarch') as
		{ id: string } | undefined;
	if (!owner) throw new Error('owner user missing');

	db.prepare("delete from faces where id like 'e2e09-%'").run();
	db.prepare("delete from item_people where item_id like 'e2e09-%'").run();
	db.prepare("delete from item_files where item_id like 'e2e09-%'").run();
	db.prepare("delete from items where id like 'e2e09-%'").run();
	db.prepare("delete from people where id like 'e2e09-%'").run();

	const itemId = 'e2e09-face-item';
	const personId = 'e2e09-person-marta';
	const personSlug = 'marta-face-review-e2e09';
	const clusterId = 'e2e09-cluster-a';

	db.prepare(
		'insert into people (id, name, slug, accent_color, created_at) values (?, ?, ?, ?, ?)'
	).run(personId, 'Marta Face Review', personSlug, '#A8D8EA', Date.now());

	writeMedia(`media/${itemId}/thumb_400.webp`);
	writeMedia(`media/${itemId}/thumb_800.webp`);
	writeMedia(`media/${itemId}/thumb_1600.webp`);
	db.prepare(
		`insert into items
			(id, type, title, description, date_start, date_end, date_precision, sort_date, width, height,
			 size_bytes, sha256, source, status, uploaded_by, created_at)
			values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		itemId,
		'photo',
		'Face Review Moment',
		null,
		'1994-06-14',
		'1994-06-14',
		'day',
		'1994-06-14',
		800,
		600,
		1000,
		'face-review-e2e09'.padEnd(64, '0'),
		'upload',
		'ready',
		owner.id,
		Date.now()
	);
	for (const kind of ['thumb_400', 'thumb_800', 'thumb_1600']) {
		db.prepare(
			'insert into item_files (id, item_id, kind, storage_key, mime, width, height) values (?, ?, ?, ?, ?, ?, ?)'
		).run(
			`${itemId}-${kind}`,
			itemId,
			kind,
			`media/${itemId}/${kind}.webp`,
			'image/webp',
			400,
			300
		);
	}
	db.prepare(
		'insert into faces (id, item_id, frame_time, box, embedding, cluster_id, person_id, status) values (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(
		'e2e09-face-a',
		itemId,
		null,
		JSON.stringify({ x: 0.18, y: 0.18, w: 0.32, h: 0.36 }),
		EMB,
		clusterId,
		null,
		'pending'
	);

	db.close();
	return { itemId, personId, personSlug, clusterId };
}

function writeMedia(key: string): void {
	const path = join(MEDIA_ROOT, key);
	mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
	writeFileSync(path, WEBP_1PX);
}
