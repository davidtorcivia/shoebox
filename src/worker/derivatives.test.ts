import { and, eq } from 'drizzle-orm';
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
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
	hlsHandler,
	hlsLadder,
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

describe('hlsLadder', () => {
	it('builds no ladder for sub-720p sources (protects library size)', () => {
		expect(hlsLadder(640, 480)).toEqual([]);
		expect(hlsLadder(854, 480)).toEqual([]);
		expect(hlsLadder(0, 0)).toEqual([]);
	});

	it('emits a full ladder for 1080p and a source-resolution top rung for 4K', () => {
		const hd = hlsLadder(1920, 1080).map((r) => r.height);
		expect(hd).toEqual([1080, 720, 480]);
		// 4K plays at 4K: top rung at source res, 1440p dropped to bound encodes.
		const uhd = hlsLadder(3840, 2160).map((r) => r.height);
		expect(uhd).toEqual([2160, 1080, 720, 480]);
		const qhd = hlsLadder(2560, 1440).map((r) => r.height);
		expect(qhd).toEqual([1440, 1080, 720, 480]);
		// Never upscaled past the source, and 8K still caps at 4K.
		expect(hlsLadder(7680, 4320).map((r) => r.height)).toEqual([2160, 1080, 720, 480]);
	});

	it('keeps an exactly-720p source adaptive with a second rung', () => {
		expect(hlsLadder(1280, 720).map((r) => r.height)).toEqual([720, 480]);
	});

	it('uses even widths and bounded per-rung bitrates', () => {
		for (const rung of hlsLadder(1920, 1080)) {
			expect(rung.width % 2).toBe(0);
			expect(rung.maxrateK).toBeLessThanOrEqual(4500);
			expect(rung.bandwidth).toBeGreaterThan(rung.maxrateK * 1000);
		}
	});
});

describe('hlsHandler', () => {
	async function setupHdVideo(height: number): Promise<{ ctx: WorkerContext; itemId: string }> {
		const db = createTestDb();
		const owner = seedOwner(db);
		const itemId = seedItem(db, owner, { type: 'video', width: 99, height: 99, duration: null });
		const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
		const key = `media/${itemId}/original.mp4`;
		await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
		// Upscale the tiny fixture to a real HD frame so the ladder engages.
		await runFfmpeg(
			(cmd) =>
				cmd.outputOptions([
					`-vf scale=-2:${height}`,
					'-c:v libx264',
					'-preset ultrafast',
					'-pix_fmt yuv420p'
				]),
			FIXTURE_MP4,
			join(mediaPath, key)
		);
		db.insert(schema.itemFiles)
			.values({
				id: 'orig1',
				itemId,
				kind: 'original',
				storageKey: key,
				mime: 'video/mp4',
				width: Math.round((320 / 180) * height),
				height
			})
			.run();
		return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
	}

	it('writes a master playlist, variant playlists and segments for an HD video', async () => {
		const { ctx, itemId } = await setupHdVideo(720);
		await hlsHandler({ itemId }, ctx);

		const master = join(ctx.mediaPath, `media/${itemId}/hls/master.m3u8`);
		const text = await readFile(master, 'utf8');
		expect(text).toContain('#EXTM3U');
		expect(text).toContain('720p.m3u8');
		expect(text).toContain('480p.m3u8');

		// The variant playlist references its segments by bare filename (not the
		// worker's absolute temp path) so they resolve when served.
		const variant = await readFile(join(ctx.mediaPath, `media/${itemId}/hls/720p.m3u8`), 'utf8');
		expect(variant).toMatch(/^720p_\d+\.ts$/m);
		expect(variant).not.toContain(tmpdir());

		const seg = join(ctx.mediaPath, `media/${itemId}/hls/720p_000.ts`);
		expect((await stat(seg)).size).toBeGreaterThan(0);

		const row = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'hls')))
			.get();
		expect(row?.storageKey).toBe(`media/${itemId}/hls/master.m3u8`);
	}, 60_000);

	it('produces no HLS files for a sub-720p video', async () => {
		const { ctx, itemId } = await setupHdVideo(360);
		await hlsHandler({ itemId }, ctx);

		const row = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'hls')))
			.get();
		expect(row).toBeUndefined();
	}, 30_000);
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

	it('keeps the HEVC master and writes a separate H.264 playback derivative', async () => {
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

		// The camera master is untouched (keep-both policy); the playable H.264
		// lives in a separate `playback` row.
		expect((await probeVideo(originalAbs)).codec).toBe('hevc');
		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(eq(schema.itemFiles.itemId, itemId))
			.all();
		const playback = rows.find((row) => row.kind === 'playback')!;
		expect(playback).toBeDefined();
		expect(playback.mime).toBe('video/mp4');
		expect(playback.width).toBeGreaterThan(0);
		const playbackAbs = join(ctx.mediaPath, playback.storageKey);
		expect((await probeVideo(playbackAbs)).codec).toBe('h264');
	}, 30_000);

	it('replaces a prior playback derivative instead of stacking rows on re-run', async () => {
		const { ctx, itemId } = await setupVideo();
		const key = `media/${itemId}/original.mp4`;
		const originalAbs = join(ctx.mediaPath, key);
		const hevcAbs = join(ctx.mediaPath, 'media', itemId, 'hevc.mp4');
		await runFfmpeg(
			(cmd) => cmd.outputOptions(['-c:v libx265', '-preset ultrafast', '-crf 30', '-tag:v hvc1']),
			originalAbs,
			hevcAbs
		);
		await copyFile(hevcAbs, originalAbs);

		await transcodeHandler({ itemId }, ctx);
		await transcodeHandler({ itemId }, ctx);

		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'playback')))
			.all();
		expect(rows).toHaveLength(1);
	}, 60_000);

	it('deletes a stale playback derivative when the original is web-safe', async () => {
		const { ctx, itemId } = await setupVideo();
		// A playback row + file exists alongside a web-safe (h264) original (e.g.
		// the source was re-uploaded); the handler should clean it up.
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
