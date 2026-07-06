// Seeds a rich, coherent "Vance family archive" into the local dev database and
// writes real webp derivatives straight to the media directory — so the app
// renders a full timeline, item rooms, people, albums, and comments WITHOUT
// needing the upload flow or the worker running.
//
// Run:  pnpm tsx scripts/seed-demo.ts
//
// Destructive: wipes all rows and regenerates media from scratch, safe to
// re-run. Demo credentials are printed at the end.
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { canonicalRel } from '../src/lib/domain/relationships';
import { ACCENTS } from '../src/lib/ui/tokens';
import { addComment } from '../src/lib/server/comments';
import { addAlbumItems, createAlbum } from '../src/lib/server/albums';
import { createItem } from '../src/lib/server/items';
import { createPerson, updatePerson } from '../src/lib/server/people';
import { reindexAll } from '../src/lib/server/search';
import { openNodeDb } from '../src/lib/server/platform/db-node';
import { createFsStorage } from '../src/lib/server/platform/storage-fs';
import type { Db } from '../src/lib/server/db';
import type { SessionUser } from '../src/lib/server/auth';
import type { JobQueueAdapter, StorageAdapter } from '../src/lib/server/platform/types';
import * as schema from '../src/lib/server/db/schema';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(here, '..');
const SEED_SRC = join(ROOT, 'seed-src');
const DB_PATH = process.env.DATABASE_PATH ?? join(ROOT, 'data', 'shoebox.db');
const MEDIA_ROOT = process.env.MEDIA_PATH ?? join(ROOT, 'media');

const PBKDF2_ITERATIONS = 310_000;
const USERNAME = 'family';
const PASSWORD = 'shoebox-demo';
const IRIS_USERNAME = 'iris';

function hashPassword(pw: string): string {
	const salt = randomBytes(16);
	const hash = pbkdf2Sync(pw, salt, PBKDF2_ITERATIONS, 32, 'sha256');
	return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

interface SceneDef {
	src: string;
	title: string;
	description: string;
	date: string;
	tape?: string;
	tags: string[];
	people: string[];
}

interface PortraitDef {
	src: string;
	name: string;
	birthdate: string;
	birthPlace: string;
	bio: string;
}

interface AlbumDef {
	title: string;
	description: string;
	items: string[];
	cover: string;
}

const PORTRAITS: PortraitDef[] = [
	{
		src: 'portrait-01.jpg',
		name: 'Elena Vance',
		birthdate: '1958-03-22',
		birthPlace: 'Burlington, Vermont',
		bio: 'The family’s quiet center. Kept the garden, kept the books, and somehow kept everyone in the same room.'
	},
	{
		src: 'portrait-02.jpg',
		name: 'Walter Vance',
		birthdate: '1956-09-10',
		birthPlace: 'Portland, Maine',
		bio: 'Carpenter, storyteller, impossible optimist. Built the lake house one summer with only a borrowed truck.'
	},
	{
		src: 'portrait-03.jpg',
		name: 'Iris Vance',
		birthdate: '1989-06-18',
		birthPlace: 'Burlington, Vermont',
		bio: 'Photographer. Took most of the pictures she isn’t in — which is why she’s rarely in the archive.'
	},
	{
		src: 'portrait-04.jpg',
		name: 'Mateo Reyes',
		birthdate: '1986-02-02',
		birthPlace: 'Santa Fe, New Mexico',
		bio: 'Married in. Patient, precise, makes the coffee. The reason anything in this house is labelled.'
	},
	{
		src: 'portrait-05.jpg',
		name: 'June Vance',
		birthdate: '2015-11-30',
		birthPlace: 'Burlington, Vermont',
		bio: 'Born during the first snow of the year. Has opinions about everything, at volume.'
	},
	{
		src: 'portrait-06.jpg',
		name: 'Theo Vance',
		birthdate: '2018-04-04',
		birthPlace: 'Burlington, Vermont',
		bio: 'The youngest. Fearless, loud about it, and already better with the camera than the rest of us.'
	}
];

const SCENES: SceneDef[] = [
	{
		src: 'scene-01.jpg',
		title: 'Golden Hour',
		description: 'The summer we practically lived on the water.',
		date: '1996-07-14',
		tags: ['lake', 'summer'],
		people: ['Elena Vance', 'Walter Vance', 'Iris Vance']
	},
	{
		src: 'scene-02.jpg',
		title: 'Morning Light',
		description: 'Slow Sunday. Walter burnt the toast again.',
		date: '1999-05-02',
		tags: ['home', 'spring'],
		people: ['Elena Vance', 'Iris Vance']
	},
	{
		src: 'scene-03.jpg',
		title: 'The Long Way Home',
		description: 'Took the long way back. Nobody complained.',
		date: '2003-08-21',
		tape: 'Tape 14B',
		tags: ['road', 'travel'],
		people: ['Walter Vance', 'Elena Vance']
	},
	{
		src: 'scene-04.jpg',
		title: 'Quiet Hours',
		description: 'First warm fire of the season.',
		date: '2007-12-26',
		tags: ['winter', 'home'],
		people: ['Iris Vance', 'Mateo Reyes']
	},
	{
		src: 'scene-05.jpg',
		title: 'Late Summer',
		description: 'The garden finally came in.',
		date: '2010-06-30',
		tags: ['garden', 'summer'],
		people: ['Elena Vance', 'Walter Vance', 'Iris Vance']
	},
	{
		src: 'scene-06.jpg',
		title: 'Westward',
		description: 'Drove until the road ran out.',
		date: '2014-09-08',
		tags: ['travel', 'coast'],
		people: ['Iris Vance', 'Mateo Reyes']
	},
	{
		src: 'scene-07.jpg',
		title: 'After the Rain',
		description: 'Everything smelled like wet pine.',
		date: '2017-04-11',
		tags: ['spring', 'garden'],
		people: ['Iris Vance', 'Mateo Reyes', 'June Vance']
	},
	{
		src: 'scene-08.jpg',
		title: 'First Light',
		description: 'The cabin, before anyone else was up.',
		date: '2018-01-01',
		tags: ['winter', 'cabin'],
		people: ['Iris Vance', 'Mateo Reyes', 'June Vance', 'Theo Vance']
	},
	{
		src: 'scene-09.jpg',
		title: 'Festival Night',
		description: 'We almost didn’t go. Glad we did.',
		date: '2019-07-20',
		tags: ['summer', 'travel'],
		people: ['Elena Vance', 'Walter Vance', 'Iris Vance', 'Mateo Reyes', 'June Vance', 'Theo Vance']
	},
	{
		src: 'scene-10.jpg',
		title: 'Garden Days',
		description: 'The year everything grew.',
		date: '2020-05-16',
		tags: ['garden', 'home'],
		people: ['Iris Vance', 'June Vance', 'Theo Vance']
	},
	{
		src: 'scene-11.jpg',
		title: 'Open Road',
		description: 'Walter’s last big drive.',
		date: '2021-10-03',
		tape: 'Tape 22A',
		tags: ['road', 'autumn'],
		people: ['Walter Vance', 'Iris Vance']
	},
	{
		src: 'scene-12.jpg',
		title: 'Slow Water',
		description: 'Low tide, long exposure, no rush.',
		date: '2023-11-02',
		tags: ['travel', 'coast'],
		people: ['Elena Vance', 'Iris Vance', 'June Vance', 'Theo Vance']
	},
	{
		src: 'scene-13.jpg',
		title: 'Tide Pool',
		description: 'June found a crab and would not let it go.',
		date: '2023-06-12',
		tags: ['coast', 'summer'],
		people: ['Iris Vance', 'June Vance', 'Theo Vance']
	},
	{
		src: 'scene-14.jpg',
		title: 'The Long Table',
		description: 'Everyone home for once. Not enough chairs.',
		date: '2023-08-05',
		tags: ['home', 'summer'],
		people: ['Elena Vance', 'Walter Vance', 'Iris Vance', 'Mateo Reyes', 'June Vance', 'Theo Vance']
	},
	{
		src: 'scene-15.jpg',
		title: 'North Window',
		description: 'February light. The kind that makes you put the camera down slow.',
		date: '2023-02-18',
		tags: ['home', 'winter'],
		people: ['Iris Vance']
	},
	{
		src: 'scene-16.jpg',
		title: 'Last Light',
		description: 'The last warm evening of the year.',
		date: '2023-10-29',
		tags: ['autumn', 'lake'],
		people: ['Elena Vance', 'Iris Vance']
	},
	{
		src: 'scene-17.jpg',
		title: 'Paper Lanterns',
		description: 'The whole street was lit.',
		date: '2019-07-21',
		tags: ['travel', 'summer'],
		people: ['Iris Vance', 'Mateo Reyes']
	},
	{
		src: 'scene-18.jpg',
		title: 'Hotel Morning',
		description: 'June up before any of us. Already drawing on the menu.',
		date: '2019-07-19',
		tags: ['travel', 'summer'],
		people: ['Iris Vance', 'Mateo Reyes', 'June Vance']
	},
	{
		src: 'scene-19.jpg',
		title: 'Boardwalk',
		description: 'Walter at the rail, watching nothing in particular.',
		date: '2019-07-22',
		tags: ['travel', 'coast'],
		people: ['Walter Vance', 'Iris Vance']
	},
	{
		src: 'scene-20.jpg',
		title: 'Headland',
		description: 'The wind nearly took the tripod.',
		date: '2014-09-09',
		tags: ['travel', 'coast'],
		people: ['Iris Vance', 'Mateo Reyes']
	},
	{
		src: 'scene-21.jpg',
		title: 'Salt Air',
		description: 'First morning by the water that trip.',
		date: '2014-09-07',
		tags: ['travel', 'coast'],
		people: ['Iris Vance']
	},
	{
		src: 'scene-22.jpg',
		title: 'Back Steps',
		description: 'Fourth of July. Walter on grill duty.',
		date: '2010-07-04',
		tags: ['home', 'summer'],
		people: ['Elena Vance', 'Walter Vance', 'Iris Vance']
	}
];

// scene-09 becomes the video item: same poster image, real clip as the original.
const VIDEO = {
	src: 'scene-09.jpg',
	clip: join(ROOT, 'e2e', 'fixtures', 'clip.mp4'),
	title: 'Festival Night',
	description: 'We almost didn’t go. Glad we did.',
	date: '2019-07-20',
	duration: 14.2,
	tags: ['summer', 'travel'],
	people: SCENES[8]!.people
};

const RELATIONSHIPS: Array<{
	a: string;
	b: string;
	type: 'parent-of' | 'spouse-of' | 'sibling-of';
}> = [
	{ a: 'Elena Vance', b: 'Walter Vance', type: 'spouse-of' },
	{ a: 'Elena Vance', b: 'Iris Vance', type: 'parent-of' },
	{ a: 'Walter Vance', b: 'Iris Vance', type: 'parent-of' },
	{ a: 'Iris Vance', b: 'Mateo Reyes', type: 'spouse-of' },
	{ a: 'Iris Vance', b: 'June Vance', type: 'parent-of' },
	{ a: 'Iris Vance', b: 'Theo Vance', type: 'parent-of' },
	{ a: 'Mateo Reyes', b: 'June Vance', type: 'parent-of' },
	{ a: 'Mateo Reyes', b: 'Theo Vance', type: 'parent-of' },
	{ a: 'June Vance', b: 'Theo Vance', type: 'sibling-of' }
];

const ALBUMS: AlbumDef[] = [
	{
		title: 'The Lake House',
		description: 'Twenty summers on the water.',
		items: ['scene-01', 'scene-05', 'scene-07'],
		cover: 'scene-01'
	},
	{
		title: 'On the Road',
		description: 'Miles, mostly good ones.',
		items: ['scene-03', 'scene-06', 'scene-11'],
		cover: 'scene-06'
	},
	{
		title: 'Slow Years',
		description: 'The quiet ones, 2018 onward.',
		items: ['scene-08', 'scene-10', 'scene-12'],
		cover: 'scene-12'
	},
	{
		title: 'Festival Night & Other Evenings',
		description: 'Film from the trips that almost didn’t happen.',
		items: ['scene-09', 'scene-04', 'scene-12'],
		cover: 'scene-09'
	}
];

interface CommentDef {
	on: string;
	as: 'family' | 'iris';
	body: string;
	/** minutes to stagger created_at so order is stable. */
	ago: number;
}

const COMMENTS: CommentDef[] = [
	{
		on: 'scene-01',
		as: 'iris',
		ago: 60 * 24 * 3,
		body: 'That summer the screen door never stopped swinging.'
	},
	{
		on: 'scene-01',
		as: 'family',
		ago: 60 * 24 * 2,
		body: 'Walter fell asleep in that chair every single night.'
	},
	{
		on: 'scene-04',
		as: 'family',
		ago: 60 * 30,
		body: 'Our first winter in the house. The chimney smoked for a week.'
	},
	{ on: 'scene-09', as: 'iris', ago: 60 * 12, body: 'We almost didn’t go. Glad we did.' },
	{
		on: 'scene-10',
		as: 'iris',
		ago: 60 * 5,
		body: 'June insisted the tomatoes were taller than her. She was right.'
	},
	{ on: 'portrait-03', as: 'family', ago: 60 * 24, body: 'Behind the lens, as usual.' }
];

// Centered face-ish crop for the pravatar headshots (faces are roughly centered).
const AVATAR_CROP = { x: 0.18, y: 0.08, w: 0.64, h: 0.74 };

const CLEAR_TABLES = [
	'item_people',
	'item_tags',
	'item_files',
	'album_items',
	'comments',
	'relationships',
	'faces',
	'jobs',
	'shares',
	'invites',
	'items',
	'albums',
	'people',
	'tags',
	'sessions',
	'users',
	'settings',
	'year_counts'
];

function clearAll(db: Db): void {
	db.transaction(() => {
		for (const t of CLEAR_TABLES) db.run(sql`DELETE FROM ${sql.identifier(t)}`);
	});
}

// Round-keeping height for a target width — preserves aspect, never zero.
function heightFor(width: number, w: number, h: number): number {
	return Math.max(1, Math.round((h * width) / w));
}

interface DerivSpec {
	kind: string;
	key: string;
	w: number;
	h: number;
	original: boolean;
}

async function writeImageDerivatives(
	storage: StorageAdapter,
	id: string,
	bytes: Buffer
): Promise<{ width: number; height: number; files: DerivSpec[] }> {
	const meta = await sharp(bytes).metadata();
	const width = meta.width ?? 1600;
	const height = meta.height ?? 1200;

	const toWebp = (w: number) =>
		sharp(bytes).resize({ width: w, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();

	const [t400, t800, t1600] = await Promise.all([toWebp(400), toWebp(800), toWebp(1600)]);

	await storage.put(`media/${id}/original.jpg`, bytes, { contentType: 'image/jpeg' });
	await storage.put(`media/${id}/poster.webp`, t1600, { contentType: 'image/webp' });
	await storage.put(`media/${id}/thumb_1600.webp`, t1600, { contentType: 'image/webp' });
	await storage.put(`media/${id}/thumb_800.webp`, t800, { contentType: 'image/webp' });
	await storage.put(`media/${id}/thumb_400.webp`, t400, { contentType: 'image/webp' });

	return {
		width,
		height,
		files: [
			{ kind: 'original', key: `media/${id}/original.jpg`, w: width, h: height, original: true },
			{
				kind: 'poster',
				key: `media/${id}/poster.webp`,
				w: 1600,
				h: heightFor(1600, width, height),
				original: false
			},
			{
				kind: 'thumb_1600',
				key: `media/${id}/thumb_1600.webp`,
				w: 1600,
				h: heightFor(1600, width, height),
				original: false
			},
			{
				kind: 'thumb_800',
				key: `media/${id}/thumb_800.webp`,
				w: 800,
				h: heightFor(800, width, height),
				original: false
			},
			{
				kind: 'thumb_400',
				key: `media/${id}/thumb_400.webp`,
				w: 400,
				h: heightFor(400, width, height),
				original: false
			}
		]
	};
}

function filesInput(
	specs: DerivSpec[]
): Array<{ kind: never; storageKey: string; mime: string; width: number; height: number }> {
	return specs.map((f) => ({
		kind: f.kind as never,
		storageKey: f.key,
		mime: f.original ? 'image/jpeg' : 'image/webp',
		width: f.w,
		height: f.h
	}));
}

async function main(): Promise<void> {
	console.log(`Database: ${DB_PATH}`);
	console.log(`Media:    ${MEDIA_ROOT}`);

	const db = openNodeDb(DB_PATH);
	const storage = createFsStorage(MEDIA_ROOT);
	const queue: JobQueueAdapter = { enqueue: async () => {} };

	console.log('Clearing existing data…');
	clearAll(db);
	await rm(join(MEDIA_ROOT, 'media'), { recursive: true, force: true });

	// --- Users ------------------------------------------------------------
	const now = new Date();
	const ownerRow = {
		id: nanoid(12),
		username: USERNAME,
		passwordHash: hashPassword(PASSWORD),
		role: 'owner' as const,
		accentColor: ACCENTS[0]!.hex,
		personId: null,
		comfortMode: false,
		theme: 'system' as const,
		createdAt: now
	};
	const irisRow = {
		id: nanoid(12),
		username: IRIS_USERNAME,
		passwordHash: hashPassword(PASSWORD),
		role: 'editor' as const,
		accentColor: ACCENTS[2]!.hex,
		personId: null,
		comfortMode: false,
		theme: 'system' as const,
		createdAt: new Date(now.getTime() - 86_400_000)
	};
	await db.insert(schema.users).values([ownerRow, irisRow]);

	const toSession = (row: typeof ownerRow): SessionUser => ({
		id: row.id,
		username: row.username,
		role: row.role,
		accentColor: row.accentColor,
		avatarStorageKey: null,
		personId: null,
		comfortMode: false,
		theme: 'system'
	});
	const owner = toSession(ownerRow);
	const iris = toSession(irisRow);

	// --- People -----------------------------------------------------------
	console.log('Creating people…');
	const personIds = new Map<string, string>();
	for (const p of PORTRAITS) {
		const created = await createPerson(db, {
			name: p.name,
			birthdate: p.birthdate,
			birthPlace: p.birthPlace
		});
		personIds.set(p.name, created.id);
	}

	const idsFor = (names: string[]): string[] =>
		names.map((n) => personIds.get(n)).filter((x): x is string => Boolean(x));

	// --- Portrait items (each person's avatar source) --------------------
	const itemId = new Map<string, string>();
	console.log('Creating portrait items…');
	for (const [i, p] of PORTRAITS.entries()) {
		const bytes = await readFile(join(SEED_SRC, p.src));
		const id = nanoid(12);
		const deriv = await writeImageDerivatives(storage, id, bytes);
		const item = await createItem(db, storage, queue, {
			id,
			type: 'photo',
			title: p.name,
			description: null,
			tapeLabel: null,
			date: { dateStart: p.birthdate, dateEnd: p.birthdate, precision: 'day' },
			duration: null,
			width: deriv.width,
			height: deriv.height,
			sizeBytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			source: 'upload',
			blurhash: null,
			files: filesInput(deriv.files),
			people: [personIds.get(p.name)!],
			tags: [],
			uploadedBy: owner.id
		});
		itemId.set(`portrait-${String(i + 1).padStart(2, '0')}`, item.id);
	}

	// --- Scene items ------------------------------------------------------
	console.log('Creating scene items…');
	for (const [i, s] of SCENES.entries()) {
		const bytes = await readFile(join(SEED_SRC, s.src));
		const id = nanoid(12);
		const deriv = await writeImageDerivatives(storage, id, bytes);
		const item = await createItem(db, storage, queue, {
			id,
			type: 'photo',
			title: s.title,
			description: s.description,
			tapeLabel: s.tape ?? null,
			date: { dateStart: s.date, dateEnd: s.date, precision: 'day' },
			duration: null,
			width: deriv.width,
			height: deriv.height,
			sizeBytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			source: 'upload',
			blurhash: null,
			files: filesInput(deriv.files),
			people: idsFor(s.people),
			tags: s.tags,
			uploadedBy: owner.id
		});
		itemId.set(`scene-${String(i + 1).padStart(2, '0')}`, item.id);
	}

	// --- Video item (scene-09 poster, real clip original) ----------------
	console.log('Creating video item…');
	{
		const posterBytes = await readFile(join(SEED_SRC, VIDEO.src));
		const clipBytes = await readFile(VIDEO.clip);
		const id = nanoid(12);
		const poster = await sharp(posterBytes)
			.resize({ width: 1600, withoutEnlargement: true })
			.webp({ quality: 84 })
			.toBuffer();
		const t400 = await sharp(posterBytes)
			.resize({ width: 400, withoutEnlargement: true })
			.webp({ quality: 84 })
			.toBuffer();
		const t800 = await sharp(posterBytes)
			.resize({ width: 800, withoutEnlargement: true })
			.webp({ quality: 84 })
			.toBuffer();
		await storage.put(`media/${id}/original.mp4`, clipBytes, { contentType: 'video/mp4' });
		await storage.put(`media/${id}/poster.webp`, poster, { contentType: 'image/webp' });
		await storage.put(`media/${id}/thumb_1600.webp`, poster, { contentType: 'image/webp' });
		await storage.put(`media/${id}/thumb_800.webp`, t800, { contentType: 'image/webp' });
		await storage.put(`media/${id}/thumb_400.webp`, t400, { contentType: 'image/webp' });
		await createItem(db, storage, queue, {
			id,
			type: 'video',
			title: VIDEO.title,
			description: VIDEO.description,
			tapeLabel: null,
			date: { dateStart: VIDEO.date, dateEnd: VIDEO.date, precision: 'day' },
			duration: VIDEO.duration,
			width: 1920,
			height: 1080,
			sizeBytes: clipBytes.length,
			sha256: createHash('sha256').update(clipBytes).digest('hex'),
			source: 'upload',
			blurhash: null,
			files: [
				{
					kind: 'original',
					storageKey: `media/${id}/original.mp4`,
					mime: 'video/mp4',
					width: 1920,
					height: 1080
				},
				{
					kind: 'poster',
					storageKey: `media/${id}/poster.webp`,
					mime: 'image/webp',
					width: 1600,
					height: 900
				},
				{
					kind: 'thumb_1600',
					storageKey: `media/${id}/thumb_1600.webp`,
					mime: 'image/webp',
					width: 1600,
					height: 900
				},
				{
					kind: 'thumb_800',
					storageKey: `media/${id}/thumb_800.webp`,
					mime: 'image/webp',
					width: 800,
					height: 450
				},
				{
					kind: 'thumb_400',
					storageKey: `media/${id}/thumb_400.webp`,
					mime: 'image/webp',
					width: 400,
					height: 225
				}
			],
			people: idsFor(VIDEO.people),
			tags: VIDEO.tags,
			uploadedBy: owner.id
		});
		// scene-09 key resolves to the video item for album/comment references
		itemId.set('scene-09', id);
	}

	// --- Avatars + bios ---------------------------------------------------
	console.log('Linking avatars and bios…');
	for (const [i, p] of PORTRAITS.entries()) {
		const pid = personIds.get(p.name)!;
		const key = `portrait-${String(i + 1).padStart(2, '0')}`;
		await updatePerson(db, pid, {
			avatarItemId: itemId.get(key)!,
			avatarCrop: AVATAR_CROP,
			bio: p.bio
		});
	}

	await db
		.update(schema.users)
		.set({ personId: personIds.get('Elena Vance') })
		.where(eq(schema.users.id, ownerRow.id));
	await db
		.update(schema.users)
		.set({ personId: personIds.get('Iris Vance') })
		.where(eq(schema.users.id, irisRow.id));

	// --- Relationships ----------------------------------------------------
	console.log('Creating relationships…');
	for (const rel of RELATIONSHIPS) {
		const a = personIds.get(rel.a);
		const b = personIds.get(rel.b);
		if (!a || !b) continue;
		await db
			.insert(schema.relationships)
			.values({ id: nanoid(12), ...canonicalRel({ personA: a, personB: b, type: rel.type }) });
	}

	// --- Albums -----------------------------------------------------------
	console.log('Creating albums…');
	for (const def of ALBUMS) {
		const album = await createAlbum(db, owner, { title: def.title, description: def.description });
		const items = def.items.map((k) => itemId.get(k)).filter((x): x is string => Boolean(x));
		if (items.length) await addAlbumItems(db, album.id, items);
		const cover = itemId.get(def.cover);
		if (cover)
			await db
				.update(schema.albums)
				.set({ coverItemId: cover })
				.where(eq(schema.albums.id, album.id));
	}

	// --- Comments ---------------------------------------------------------
	console.log('Adding comments…');
	for (const c of COMMENTS) {
		const target = itemId.get(c.on);
		if (!target) continue;
		const created = await addComment(db, target, c.as === 'iris' ? iris : owner, c.body);
		await db
			.update(schema.comments)
			.set({ createdAt: new Date(now.getTime() - c.ago * 60_000) })
			.where(eq(schema.comments.id, created.id));
	}

	// --- Site name --------------------------------------------------------
	await db
		.insert(schema.settings)
		.values({ key: 'siteName', value: JSON.stringify('The Vance Archive') })
		.onConflictDoUpdate({
			target: schema.settings.key,
			set: { value: JSON.stringify('The Vance Archive') }
		});

	const indexed = await reindexAll(db as never);
	console.log(`Reindexed ${indexed} items.`);

	console.log('\n✓ Seed complete.');
	console.log(
		`  Items: ${SCENES.length + PORTRAITS.length + 1}  |  People: ${PORTRAITS.length}  |  Albums: ${ALBUMS.length}`
	);
	console.log(`  Login:  ${USERNAME} / ${PASSWORD}   (also ${IRIS_USERNAME} / ${PASSWORD})`);
	console.log('  Start the app with:  pnpm dev');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
