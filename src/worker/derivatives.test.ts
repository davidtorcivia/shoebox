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
import {
	derivativesHandler,
	isRawImage,
	needsTranscode,
	probeVideo,
	runFfmpeg,
	transcodeHandler
} from './derivatives';
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

		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(eq(schema.itemFiles.itemId, itemId))
			.all();
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
		await expect(derivativesHandler({ itemId: 'nope' }, ctx)).rejects.toThrow(
			/item nope not found/
		);
	});
});

describe('probeVideo', () => {
	it('reads duration, dimensions, and codec from the fixture', async () => {
		const probe = await probeVideo(FIXTURE_MP4);
		expect(Math.abs(probe.duration - 2)).toBeLessThan(0.5);
		expect(probe.width).toBe(320);
		expect(probe.height).toBe(180);
		expect(probe.creationTime).toBeNull();
		expect(probe.codec).toBe('h264');
	}, 10_000);
});

describe('needsTranscode', () => {
	it('leaves browser-playable codecs untouched', () => {
		for (const codec of ['h264', 'H264', 'vp8', 'vp9', 'av1']) {
			expect(needsTranscode(codec)).toBe(false);
		}
	});

	it('flags HEVC and other archival codecs for transcoding', () => {
		for (const codec of ['hevc', 'h265', 'mpeg2video', 'dvvideo', 'mpeg4', 'prores']) {
			expect(needsTranscode(codec)).toBe(true);
		}
	});

	it('skips when the codec is unknown', () => {
		expect(needsTranscode(null)).toBe(false);
	});
});

describe('isRawImage', () => {
	it('flags camera RAW mimes that sharp cannot decode', () => {
		for (const mime of [
			'image/x-canon-cr2',
			'image/x-canon-cr3',
			'image/x-nikon-nef',
			'image/x-sony-arw',
			'image/x-adobe-dng',
			'image/x-panasonic-rw2',
			'image/x-fujifilm-raf',
			'image/x-olympus-orf'
		]) {
			expect(isRawImage(mime)).toBe(true);
		}
	});

	it('treats HEIC and web formats as sharp-decodable', () => {
		for (const mime of ['image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp']) {
			expect(isRawImage(mime)).toBe(false);
		}
	});
});

describe('transcodeHandler', () => {
	it('does not write a playback derivative for a browser-playable video', async () => {
		const { ctx, itemId } = await setupVideo();
		await transcodeHandler({ itemId }, ctx);

		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'playback')))
			.all();
		expect(rows).toHaveLength(0);
	}, 20_000);

	it('replaces an HEVC original in place with a playable H.264 mp4', async () => {
		const { ctx, itemId } = await setupVideo();
		// Re-encode the fixture as HEVC in place so the original is a codec browsers
		// cannot play, reproducing the real-world case.
		const key = `media/${itemId}/original.mp4`;
		const originalAbs = join(ctx.mediaPath, key);
		const hevcAbs = join(ctx.mediaPath, 'media', itemId, 'hevc.mp4');
		await runFfmpeg(
			(cmd) => cmd.outputOptions(['-c:v libx265', '-preset ultrafast', '-crf 30', '-tag:v hvc1']),
			originalAbs,
			hevcAbs
		);
		await copyFile(hevcAbs, originalAbs);
		expect((await probeVideo(originalAbs)).codec).toBe('hevc');

		await transcodeHandler({ itemId }, ctx);

		// The original file is overwritten with H.264 (replace policy) — no separate
		// playback derivative, and the single `original` row now describes the H.264.
		expect((await probeVideo(originalAbs)).codec).toBe('h264');
		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(eq(schema.itemFiles.itemId, itemId))
			.all();
		expect(rows.filter((row) => row.kind === 'playback')).toHaveLength(0);
		const original = rows.find((row) => row.kind === 'original')!;
		expect(original.mime).toBe('video/mp4');
		expect(original.width).toBeGreaterThan(0);
	}, 30_000);

	it('deletes a stale playback derivative left by the old keep-both policy', async () => {
		const { ctx, itemId } = await setupVideo();
		// Simulate a prior keep-both run: a playback row + file exists alongside a
		// now web-safe (h264) original. The replace policy should clean it up.
		const staleKey = `media/${itemId}/playback.mp4`;
		await ctx.storage.put(staleKey, new Uint8Array([1, 2, 3]), { contentType: 'video/mp4' });
		ctx.db
			.insert(schema.itemFiles)
			.values({
				id: 'stale-pb',
				itemId,
				kind: 'playback',
				storageKey: staleKey,
				mime: 'video/mp4',
				width: 320,
				height: 180
			})
			.run();

		await transcodeHandler({ itemId }, ctx);

		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'playback')))
			.all();
		expect(rows).toHaveLength(0);
		expect(await ctx.storage.head(staleKey)).toBeNull();
	}, 20_000);
});

describe('derivativesHandler for videos', () => {
	it('writes poster and thumbs and fixes metadata from ffprobe', async () => {
		const { ctx, itemId } = await setupVideo();
		await derivativesHandler({ itemId }, ctx);

		const posterAbs = join(ctx.mediaPath, `media/${itemId}/poster.webp`);
		const posterMeta = await sharp(posterAbs).metadata();
		expect(posterMeta.format).toBe('webp');
		expect(posterMeta.width).toBe(320);

		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(eq(schema.itemFiles.itemId, itemId))
			.all();
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
				(cmd) => cmd.seekInput(0.05).outputOptions(['-frames:v 1', '-vf scale=160:-2']),
				FIXTURE_MP4,
				out,
				1
			)
		).rejects.toThrow(/timed out/i);
		await rm(tmp, { recursive: true, force: true });
	}, 10_000);
});
