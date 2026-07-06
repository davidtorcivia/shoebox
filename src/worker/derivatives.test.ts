import { and, eq } from 'drizzle-orm';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate';
import * as schema from '../lib/server/db/schema';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import { derivativesHandler, probeVideo, runFfmpeg } from './derivatives';
import type { WorkerContext } from './jobs';
import { createTestDb, seedItem, seedOwner } from './test-helpers';

beforeAll(async () => {
	await generateFixtures();
});

async function setupPhoto(): Promise<{ ctx: WorkerContext; itemId: string }> {
	const db = createTestDb();
	const owner = seedOwner(db);
	const itemId = seedItem(db, owner, { type: 'photo', width: 1, height: 1 });
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	const key = `media/${itemId}/original.jpg`;
	await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
	await copyFile(FIXTURE_JPG, join(mediaPath, key));
	db.insert(schema.itemFiles)
		.values({
			id: 'orig1',
			itemId,
			kind: 'original',
			storageKey: key,
			mime: 'image/jpeg',
			width: 640,
			height: 480
		})
		.run();
	return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

async function setupVideo(): Promise<{ ctx: WorkerContext; itemId: string }> {
	const db = createTestDb();
	const owner = seedOwner(db);
	const itemId = seedItem(db, owner, { type: 'video', width: 99, height: 99, duration: null });
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	const key = `media/${itemId}/original.mp4`;
	await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
	await copyFile(FIXTURE_MP4, join(mediaPath, key));
	db.insert(schema.itemFiles)
		.values({
			id: 'orig1',
			itemId,
			kind: 'original',
			storageKey: key,
			mime: 'video/mp4',
			width: 320,
			height: 180
		})
		.run();
	return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

describe('derivativesHandler for photos', () => {
	it('writes thumb_400/800/1600 webp under contract keys and records item_files rows', async () => {
		const { ctx, itemId } = await setupPhoto();
		await derivativesHandler({ itemId }, ctx);

		for (const width of [400, 800, 1600]) {
			const abs = join(ctx.mediaPath, `media/${itemId}/thumb_${width}.webp`);
			expect((await stat(abs)).size).toBeGreaterThan(0);
			const meta = await sharp(abs).metadata();
			expect(meta.format).toBe('webp');
		}

		const rows = ctx.db.select().from(schema.itemFiles).where(eq(schema.itemFiles.itemId, itemId)).all();
		const kinds = rows.map((row) => row.kind).sort();
		expect(kinds).toEqual(['original', 'thumb_1600', 'thumb_400', 'thumb_800']);

		const rowWidth = (kind: string): number | null =>
			rows.find((row) => row.kind === kind)?.width ?? null;
		expect(rowWidth('thumb_400')).toBe(400);
		expect(rowWidth('thumb_800')).toBe(640);
		expect(rowWidth('thumb_1600')).toBe(640);
	});

	it('corrects items width and height from the real pixels', async () => {
		const { ctx, itemId } = await setupPhoto();
		await derivativesHandler({ itemId }, ctx);

		const item = ctx.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.width).toBe(640);
		expect(item.height).toBe(480);
	});

	it('is idempotent and replaces rows instead of duplicating them', async () => {
		const { ctx, itemId } = await setupPhoto();
		await derivativesHandler({ itemId }, ctx);
		await derivativesHandler({ itemId }, ctx);

		const thumbs = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'thumb_400')))
			.all();
		expect(thumbs).toHaveLength(1);
	});

	it('throws so the job retries when the item does not exist', async () => {
		const { ctx } = await setupPhoto();
		await expect(derivativesHandler({ itemId: 'nope' }, ctx)).rejects.toThrow(/item nope not found/);
	});
});

describe('probeVideo', () => {
	it('reads duration and dimensions from the fixture', async () => {
		const probe = await probeVideo(FIXTURE_MP4);
		expect(Math.abs(probe.duration - 2)).toBeLessThan(0.5);
		expect(probe.width).toBe(320);
		expect(probe.height).toBe(180);
		expect(probe.creationTime).toBeNull();
	}, 10_000);
});

describe('derivativesHandler for videos', () => {
	it('writes poster and thumbs and fixes metadata from ffprobe', async () => {
		const { ctx, itemId } = await setupVideo();
		await derivativesHandler({ itemId }, ctx);

		const posterAbs = join(ctx.mediaPath, `media/${itemId}/poster.webp`);
		const posterMeta = await sharp(posterAbs).metadata();
		expect(posterMeta.format).toBe('webp');
		expect(posterMeta.width).toBe(320);

		const rows = ctx.db.select().from(schema.itemFiles).where(eq(schema.itemFiles.itemId, itemId)).all();
		expect(rows.map((row) => row.kind).sort()).toEqual([
			'original',
			'poster',
			'thumb_1600',
			'thumb_400',
			'thumb_800'
		]);

		const item = ctx.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(Math.abs((item.duration ?? 0) - 2)).toBeLessThan(0.5);
		expect(item.width).toBe(320);
		expect(item.height).toBe(180);
	}, 10_000);
});

describe('ffmpeg / ffprobe timeouts', () => {
	it('rejects when ffprobe exceeds its timeout', async () => {
		await expect(probeVideo(FIXTURE_MP4, 1)).rejects.toThrow(/timed out/i);
	}, 10_000);

	it('rejects when ffmpeg exceeds its timeout and leaves no running process', async () => {
		const tmp = mkdtempSync(join(tmpdir(), 'shoebox-ff-to-'));
		const out = join(tmp, 'poster.png');
		await expect(
			runFfmpeg(
				(cmd) => cmd.seekInput(0.05).outputOptions(['-frames:v 1', "-vf scale=160:-2"]),
				FIXTURE_MP4,
				out,
				1
			)
		).rejects.toThrow(/timed out/i);
		await rm(tmp, { recursive: true, force: true });
	}, 10_000);
});
