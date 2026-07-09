import Database from 'better-sqlite3';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = 'e2e/.data/shoebox.db';
const MEDIA_ROOT = 'e2e/.data/media';
const WEBP_1PX = Buffer.from(
	'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
	'base64'
);

export const PHASE05_USER = { username: 'phase05-margaret', password: 'phase05-pass-123' };

export interface Phase05Seed {
	ownerId: string;
	linkedUserId: string;
	people: {
		margaret: string;
		frank: string;
		david: string;
		carol: string;
	};
	slugs: {
		margaret: string;
	};
	itemIds: string[];
}

export function seedPhase05(): Phase05Seed {
	const db = new Database(DB_PATH);
	const owner = db.prepare('select id from users where username = ?').get('matriarch') as
		{ id: string } | undefined;
	if (!owner) throw new Error('owner user missing');

	const oldItems = db.prepare("select id from items where id like 'e2e05-%'").all() as {
		id: string;
	}[];
	for (const item of oldItems) {
		db.prepare('delete from comments where item_id = ?').run(item.id);
		db.prepare('delete from album_items where item_id = ?').run(item.id);
		db.prepare('delete from item_people where item_id = ?').run(item.id);
		db.prepare('delete from item_files where item_id = ?').run(item.id);
		db.prepare('delete from items where id = ?').run(item.id);
	}
	db.prepare("delete from album_items where album_id like 'e2e05-%'").run();
	db.prepare("delete from albums where id like 'e2e05-%' or title = 'Summer at the Lake'").run();
	db.prepare(
		"delete from relationships where person_a like 'e2e05-%' or person_b like 'e2e05-%'"
	).run();
	db.prepare("delete from sessions where user_id like 'e2e05-%'").run();
	db.prepare("delete from users where id like 'e2e05-%'").run();
	db.prepare("delete from people where id like 'e2e05-%'").run();

	const linkedUserId = 'e2e05-user-margaret';
	db.prepare(
		`insert into users
			(id, username, password_hash, role, accent_color, person_id, comfort_mode, theme, created_at)
			values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		linkedUserId,
		PHASE05_USER.username,
		hashPasswordSync(PHASE05_USER.password),
		'user',
		'#FFD9A8',
		null,
		0,
		'system',
		Date.now()
	);

	const people = {
		margaret: 'e2e05-margaret',
		frank: 'e2e05-frank',
		david: 'e2e05-david',
		carol: 'e2e05-carol'
	};
	const slugs = { margaret: 'margaret-torcivia-e2e05' };
	const personRows = [
		[
			people.margaret,
			'Margaret Torcivia',
			slugs.margaret,
			'1941-03-15',
			'2019-06-01',
			'Brooklyn, New York',
			'#D3826E'
		],
		[people.frank, 'Frank Torcivia', 'frank-torcivia-e2e05', null, null, null, '#446179'],
		[people.david, 'David Sr.', 'david-sr-e2e05', null, null, null, '#FFD9A8'],
		[people.carol, 'Carol', 'carol-e2e05', null, null, null, '#A8D8EA']
	] as const;
	const insertPerson = db.prepare(
		`insert into people
			(id, name, slug, birthdate, death_date, birth_place, accent_color, created_at)
			values (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const row of personRows) insertPerson.run(...row, Date.now());

	const itemIds = ['e2e05-item-1993-a', 'e2e05-item-1994-a', 'e2e05-item-1994-b'];
	const dates = ['1993-06-01', '1994-06-14', '1994-07-04'];
	for (let index = 0; index < itemIds.length; index += 1) {
		const id = itemIds[index];
		const date = dates[index];
		writeMedia(`media/${id}/poster.webp`);
		writeMedia(`media/${id}/thumb_400.webp`);
		writeMedia(`media/${id}/thumb_800.webp`);
		writeMedia(`media/${id}/thumb_1600.webp`);
		db.prepare(
			`insert into items
				(id, type, title, description, date_start, date_end, date_precision, sort_date, width, height,
				 size_bytes, sha256, source, status, uploaded_by, created_at)
				values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			id,
			'photo',
			`Phase 05 Moment ${index + 1}`,
			null,
			date,
			date,
			'day',
			date,
			800,
			600,
			1000,
			`phase05-${index}`.padEnd(64, String(index)),
			'upload',
			'ready',
			owner.id,
			Date.now()
		);
		for (const kind of ['poster', 'thumb_400', 'thumb_800', 'thumb_1600']) {
			db.prepare(
				'insert into item_files (id, item_id, kind, storage_key, mime, width, height) values (?, ?, ?, ?, ?, ?, ?)'
			).run(`${id}-${kind}`, id, kind, `media/${id}/${kind}.webp`, 'image/webp', 400, 300);
		}
		db.prepare('insert into item_people (item_id, person_id, source) values (?, ?, ?)').run(
			id,
			people.margaret,
			'manual'
		);
	}

	db.close();
	return { ownerId: owner.id, linkedUserId, people, slugs, itemIds };
}

function writeMedia(key: string): void {
	const path = join(MEDIA_ROOT, key);
	mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
	writeFileSync(path, WEBP_1PX);
}

function hashPasswordSync(password: string): string {
	const salt = randomBytes(16);
	const hash = pbkdf2Sync(password, salt, 310_000, 32, 'sha256');
	return `pbkdf2$310000$${salt.toString('base64')}$${hash.toString('base64')}`;
}
