import { expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const OWNER = { username: 'matriarch', password: 'super-secret-8' };

const DB_PATH = 'e2e/.data/shoebox.db';
const MEDIA_ROOT = 'e2e/.data/media';

type SeededPlayer = {
	videoId: string;
	photoId: string;
	personId: string;
	albumId: string;
};

export async function ensureOwner(page: Page): Promise<void> {
	await page.goto('/setup');
	if (await page.getByRole('heading', { name: 'Set up Shoebox' }).isVisible().catch(() => false)) {
		await page.getByLabel('Username').fill(OWNER.username);
		await page.getByLabel('Password').fill(OWNER.password);
		await page.getByRole('button', { name: 'Create owner' }).click();
		await page.waitForURL('/');
		return;
	}

	if (page.url().endsWith('/login')) {
		await page.getByLabel('Username').fill(OWNER.username);
		await page.getByLabel('Password').fill(OWNER.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('/');
	}
}

export async function seedPlayerRoom(page: Page): Promise<SeededPlayer> {
	const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const videoId = `e2e_vid_${suffix}`;
	const photoId = `e2e_pic_${suffix}`;
	const personId = `e2e_person_${suffix}`;
	const albumId = `e2e_album_${suffix}`;

	const db = new Database(DB_PATH);
	const owner = db.prepare('select id from users where username = ?').get(OWNER.username) as
		| { id: string }
		| undefined;
	if (!owner) throw new Error('owner user missing');

	db.prepare(
		'insert into people (id, name, accent_color, created_at) values (?, ?, ?, ?)'
	).run(personId, 'Aunt June', '#FA7B62', Date.now());

	const videoBytes = await tinyWebm(page);
	await writeMedia(`media/${videoId}/original.webm`, videoBytes);
	await writeMedia(`media/${videoId}/poster.webp`, Uint8Array.from([1]));
	await writeMedia(`media/${videoId}/thumb_400.webp`, Uint8Array.from([2]));
	await writeMedia(`media/${videoId}/thumb_800.webp`, Uint8Array.from([3]));
	await writeMedia(`media/${videoId}/thumb_1600.webp`, Uint8Array.from([4]));

	await writeMedia(`media/${photoId}/original.jpg`, Uint8Array.from([255, 216, 255, 217]));
	await writeMedia(`media/${photoId}/poster.webp`, Uint8Array.from([5]));
	await writeMedia(`media/${photoId}/thumb_400.webp`, Uint8Array.from([6]));
	await writeMedia(`media/${photoId}/thumb_800.webp`, Uint8Array.from([7]));
	await writeMedia(`media/${photoId}/thumb_1600.webp`, Uint8Array.from([8]));

	await createItem(page, {
		id: videoId,
		type: 'video',
		title: 'Player Test Clip',
		description: 'A tiny seeded video for the player room.',
		tapeLabel: 'Tape E2E',
		date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
		duration: 42,
		width: 640,
		height: 360,
		sizeBytes: videoBytes.byteLength,
		sha256: `${suffix}`.padEnd(64, '0').slice(0, 64),
		source: 'upload',
		blurhash: null,
		people: [personId],
		tags: ['player-room'],
		files: mediaFiles(videoId, 'video')
	});
	await createItem(page, {
		id: photoId,
		type: 'photo',
		title: 'Player Test Photo',
		description: 'A tiny seeded photo for the lightbox.',
		tapeLabel: 'Tape E2E',
		date: { dateStart: '1995-01-02', dateEnd: '1995-01-02', precision: 'day' },
		duration: null,
		width: 640,
		height: 480,
		sizeBytes: 4,
		sha256: `${suffix}photo`.padEnd(64, '1').slice(0, 64),
		source: 'upload',
		blurhash: null,
		people: [personId],
		tags: ['lightbox'],
		files: mediaFiles(photoId, 'photo')
	});

	db.prepare(
		'insert into albums (id, title, created_by, created_at) values (?, ?, ?, ?)'
	).run(albumId, 'Player E2E Album', owner.id, Date.now());
	db.prepare('insert into album_items (album_id, item_id, position) values (?, ?, ?)').run(
		albumId,
		videoId,
		0
	);
	db.prepare('insert into album_items (album_id, item_id, position) values (?, ?, ?)').run(
		albumId,
		photoId,
		1
	);
	db.close();

	return { videoId, photoId, personId, albumId };
}

async function createItem(page: Page, body: Record<string, unknown>): Promise<void> {
	const res = await page.request.post('/api/items', { data: body });
	expect(res.status()).toBe(201);
}

function mediaFiles(itemId: string, type: 'video' | 'photo') {
	const originalExt = type === 'video' ? 'webm' : 'jpg';
	const originalMime = type === 'video' ? 'video/webm' : 'image/jpeg';
	return [
		{
			kind: 'original',
			storageKey: `media/${itemId}/original.${originalExt}`,
			mime: originalMime,
			width: type === 'video' ? 640 : 640,
			height: type === 'video' ? 360 : 480
		},
		{
			kind: 'poster',
			storageKey: `media/${itemId}/poster.webp`,
			mime: 'image/webp',
			width: 640,
			height: type === 'video' ? 360 : 480
		},
		{
			kind: 'thumb_400',
			storageKey: `media/${itemId}/thumb_400.webp`,
			mime: 'image/webp',
			width: 400,
			height: type === 'video' ? 225 : 300
		},
		{
			kind: 'thumb_800',
			storageKey: `media/${itemId}/thumb_800.webp`,
			mime: 'image/webp',
			width: 800,
			height: type === 'video' ? 450 : 600
		},
		{
			kind: 'thumb_1600',
			storageKey: `media/${itemId}/thumb_1600.webp`,
			mime: 'image/webp',
			width: 1600,
			height: type === 'video' ? 900 : 1200
		}
	];
}

async function writeMedia(key: string, bytes: Uint8Array): Promise<void> {
	const path = join(MEDIA_ROOT, key);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
}

async function tinyWebm(page: Page): Promise<Uint8Array> {
	const bytes = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 2;
		canvas.height = 2;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#171412';
		ctx.fillRect(0, 0, 2, 2);
		const stream = canvas.captureStream(1);
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
		const chunks: Blob[] = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		});
		const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve()));
		recorder.start();
		await new Promise((resolve) => setTimeout(resolve, 250));
		ctx.fillStyle = '#FA7B62';
		ctx.fillRect(0, 0, 2, 2);
		await new Promise((resolve) => setTimeout(resolve, 250));
		recorder.stop();
		await stopped;
		for (const track of stream.getTracks()) track.stop();
		return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
	});
	return Uint8Array.from(bytes);
}
