import { and, eq, inArray } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { nanoid } from 'nanoid';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import * as schema from '../lib/server/db/schema';
import type { JobHandler, WorkerDb } from './jobs';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const THUMB_WIDTHS = [400, 800, 1600] as const;
const WEBP_QUALITY = 82;
/** Bounds ffmpeg against malformed inputs that would otherwise hang the worker.
 * Generous enough for real transcodes; ffprobe is given a shorter leash. */
const FFMPEG_TIMEOUT_MS = 180_000;
const FFPROBE_TIMEOUT_MS = 30_000;

export interface VideoProbe {
	duration: number;
	width: number;
	height: number;
	creationTime: string | null;
	/** ffprobe `codec_name` of the first video stream, lowercased (e.g. 'hevc'). */
	codec: string | null;
}

type DerivedKind = 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite' | 'playback';

/** Video codecs browsers decode natively across Chrome/Firefox/Safari. Anything
 * else (HEVC/H.265, MPEG-2, DV, MPEG-4 ASP, ProRes, …) is served as-is today and
 * silently fails to play, so we transcode it to H.264 for a playback derivative. */
const WEB_SAFE_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);

/** The full re-encode is the heaviest job; give it a much longer leash than the
 * poster/thumbnail pass while still bounding a wedged ffmpeg. */
const TRANSCODE_TIMEOUT_MS = 20 * 60_000;

export function needsTranscode(codec: string | null): boolean {
	if (!codec) return false;
	return !WEB_SAFE_VIDEO_CODECS.has(codec.toLowerCase());
}

interface DerivedRow {
	kind: DerivedKind;
	storageKey: string;
	mime: string;
	width: number;
	height: number;
}

export function normalizeCreationTime(raw: string | null): string | null {
	if (!raw) return null;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getUTCFullYear();
	if (year <= 1970 || year > 2100) return null;
	return date.toISOString().slice(0, 10);
}

export function probeVideo(filePath: string, timeoutMs = FFPROBE_TIMEOUT_MS): Promise<VideoProbe> {
	const { promise, resolve, reject } = Promise.withResolvers<VideoProbe>();
	let settled = false;
	const timer = setTimeout(() => {
		if (settled) return;
		settled = true;
		reject(new Error(`ffprobe timed out after ${timeoutMs}ms (input: ${filePath})`));
	}, timeoutMs);
	ffmpeg.ffprobe(filePath, (err, data) => {
		if (settled) return;
		if (err) {
			settled = true;
			clearTimeout(timer);
			reject(err instanceof Error ? err : new Error(String(err)));
			return;
		}
		const stream = data.streams.find((candidate) => candidate.codec_type === 'video');
		if (!stream) {
			settled = true;
			clearTimeout(timer);
			reject(new Error(`no video stream in ${filePath}`));
			return;
		}
		settled = true;
		clearTimeout(timer);
		resolve({
			duration: Number(data.format.duration ?? 0),
			width: stream.width ?? 0,
			height: stream.height ?? 0,
			creationTime: normalizeCreationTime(
				(data.format.tags?.creation_time as string | undefined) ?? null
			),
			codec: stream.codec_name ? stream.codec_name.toLowerCase() : null
		});
	});
	return promise;
}

export function runFfmpeg(
	configure: (cmd: ffmpeg.FfmpegCommand) => ffmpeg.FfmpegCommand,
	input: string,
	output: string,
	timeoutMs = FFMPEG_TIMEOUT_MS
): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const cmd = configure(ffmpeg(input)).output(output);
	let settled = false;
	const timer = setTimeout(() => {
		if (settled) return;
		settled = true;
		try {
			cmd.kill('SIGKILL');
		} catch {
			/* process already exited */
		}
		reject(new Error(`ffmpeg timed out after ${timeoutMs}ms (input: ${input})`));
	}, timeoutMs);
	cmd
		.on('end', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve();
		})
		.on('error', (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(err instanceof Error ? err : new Error(String(err)));
		})
		.run();
	return promise;
}

function replaceItemFiles(db: WorkerDb, itemId: string, rows: DerivedRow[]): void {
	db.transaction((tx) => {
		tx.delete(schema.itemFiles)
			.where(
				and(
					eq(schema.itemFiles.itemId, itemId),
					inArray(
						schema.itemFiles.kind,
						rows.map((row) => row.kind)
					)
				)
			)
			.run();

		for (const row of rows) {
			tx.insert(schema.itemFiles)
				.values({
					id: nanoid(12),
					itemId,
					...row
				})
				.run();
		}
	});
}

function loadItem(
	db: WorkerDb,
	itemId: string
): { item: typeof schema.items.$inferSelect; originalKey: string } {
	const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
	if (!item) throw new Error(`item ${itemId} not found`);

	const original = db
		.select()
		.from(schema.itemFiles)
		.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'original')))
		.get();
	if (!original) throw new Error(`item ${itemId} has no original file row`);

	return { item, originalKey: original.storageKey };
}

async function putWebp(
	ctx: Parameters<JobHandler>[1],
	itemId: string,
	kind: DerivedKind,
	source: Buffer,
	resizeWidth: number | null
): Promise<DerivedRow> {
	let pipeline = sharp(source).rotate();
	if (resizeWidth !== null) {
		pipeline = pipeline.resize({ width: resizeWidth, withoutEnlargement: true });
	}

	const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
	const storageKey = `media/${itemId}/${kind}.webp`;
	await ctx.storage.put(storageKey, new Uint8Array(out.data), { contentType: 'image/webp' });
	return {
		kind,
		storageKey,
		mime: 'image/webp',
		width: out.info.width,
		height: out.info.height
	};
}

export const derivativesHandler: JobHandler = async (payload, ctx) => {
	const itemId = String(payload.itemId ?? '');
	const { item, originalKey } = loadItem(ctx.db, itemId);
	const originalAbs = join(ctx.mediaPath, originalKey);
	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-deriv-'));

	try {
		const rows: DerivedRow[] = [];
		let thumbSource: Buffer;

		if (item.type === 'video') {
			const probe = await probeVideo(originalAbs);
			const updates: Partial<typeof schema.items.$inferInsert> = {};
			if (
				probe.duration > 0 &&
				(item.duration == null || Math.abs(item.duration - probe.duration) > 0.5)
			) {
				updates.duration = probe.duration;
			}
			if (
				probe.width > 0 &&
				probe.height > 0 &&
				(item.width !== probe.width || item.height !== probe.height)
			) {
				updates.width = probe.width;
				updates.height = probe.height;
			}
			if (Object.keys(updates).length > 0) {
				ctx.db.update(schema.items).set(updates).where(eq(schema.items.id, itemId)).run();
			}

			// Honor a user-chosen poster frame; fall back to 10% into the clip. A
			// payload override (from an immediate "set thumbnail" request) wins over
			// the stored value so re-runs and one-off regenerations agree.
			const chosen =
				typeof payload.posterTime === 'number' ? payload.posterTime : (item.posterTime ?? null);
			const posterSeek =
				chosen != null && chosen >= 0 && chosen <= probe.duration ? chosen : probe.duration * 0.1;
			const framePng = join(tmp, 'poster.png');
			await runFfmpeg(
				(cmd) =>
					cmd
						.seekInput(Math.max(0, posterSeek))
						.outputOptions(['-frames:v 1', "-vf scale='min(1600,iw)':-2"]),
				originalAbs,
				framePng
			);
			thumbSource = await readFile(framePng);
			rows.push(await putWebp(ctx, itemId, 'poster', thumbSource, null));
		} else {
			thumbSource = await readFile(originalAbs);
			const meta = await sharp(thumbSource).metadata();
			let width = meta.width ?? 0;
			let height = meta.height ?? 0;
			if ((meta.orientation ?? 1) >= 5) {
				[width, height] = [height, width];
			}
			if (width > 0 && height > 0 && (item.width !== width || item.height !== height)) {
				ctx.db.update(schema.items).set({ width, height }).where(eq(schema.items.id, itemId)).run();
			}
		}

		for (const width of THUMB_WIDTHS) {
			rows.push(await putWebp(ctx, itemId, `thumb_${width}` as DerivedKind, thumbSource, width));
		}
		replaceItemFiles(ctx.db, itemId, rows);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};

export const spriteHandler: JobHandler = async (payload, ctx) => {
	const itemId = String(payload.itemId ?? '');
	const { item, originalKey } = loadItem(ctx.db, itemId);
	if (item.type !== 'video') return;

	const originalAbs = join(ctx.mediaPath, originalKey);
	const probe = await probeVideo(originalAbs);
	if (probe.duration <= 0) throw new Error(`item ${itemId} has zero duration; cannot build sprite`);

	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-sprite-'));
	try {
		const tilePng = join(tmp, 'sprite.png');
		const fps = 100 / probe.duration;
		await runFfmpeg(
			(cmd) => cmd.outputOptions(['-frames:v 1', `-vf fps=${fps},scale=160:90,tile=10x10`]),
			originalAbs,
			tilePng
		);
		const out = await sharp(tilePng).webp({ quality: 70 }).toBuffer({ resolveWithObject: true });
		const storageKey = `media/${itemId}/sprite.webp`;
		await ctx.storage.put(storageKey, new Uint8Array(out.data), { contentType: 'image/webp' });
		replaceItemFiles(ctx.db, itemId, [
			{
				kind: 'sprite',
				storageKey,
				mime: 'image/webp',
				width: out.info.width,
				height: out.info.height
			}
		]);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};

/** Drop any leftover `playback` derivative from the earlier keep-both policy so a
 * re-run under the replace policy converges on a single H.264 `original`. */
async function removeStalePlayback(ctx: Parameters<JobHandler>[1], itemId: string): Promise<void> {
	const rows = ctx.db
		.select()
		.from(schema.itemFiles)
		.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'playback')))
		.all();
	if (rows.length === 0) return;
	for (const row of rows) await ctx.storage.delete(row.storageKey);
	ctx.db
		.delete(schema.itemFiles)
		.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'playback')))
		.run();
}

/**
 * Make a video browser-playable when its source codec (HEVC/H.265 and other
 * archival codecs) is not decodable in browsers. Storage policy is **replace**:
 * the H.264 encode overwrites the original in place — no HEVC master is kept and
 * no separate playback derivative is produced. No-op for photos or already
 * web-safe videos.
 */
export const transcodeHandler: JobHandler = async (payload, ctx) => {
	const itemId = String(payload.itemId ?? '');
	const { item, originalKey } = loadItem(ctx.db, itemId);
	if (item.type !== 'video') return;

	const originalAbs = join(ctx.mediaPath, originalKey);
	const probe = await probeVideo(originalAbs);
	if (!needsTranscode(probe.codec)) {
		await removeStalePlayback(ctx, itemId);
		return;
	}

	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-transcode-'));
	try {
		const outMp4 = join(tmp, 'transcode.mp4');
		await runFfmpeg(
			(cmd) =>
				cmd.outputOptions([
					'-map 0:v:0',
					'-map 0:a:0?',
					'-c:v libx264',
					'-preset veryfast',
					'-crf 20',
					// format=yuv420p forces 8-bit 4:2:0: HEVC sources are frequently 10-bit
					// (yuv420p10le), which browsers cannot decode even re-wrapped as H.264.
					// Cap the long edge at 1080p for a sane streaming size; even dimensions
					// (-2) are mandatory for yuv420p H.264.
					"-vf scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p",
					'-c:a aac',
					'-b:a 160k',
					'-movflags +faststart'
				]),
			originalAbs,
			outMp4,
			TRANSCODE_TIMEOUT_MS
		);

		// Overwrite the original in place with the H.264 encode (replace policy).
		const data = await readFile(outMp4);
		await ctx.storage.put(originalKey, new Uint8Array(data), { contentType: 'video/mp4' });

		// The 1080p cap may have changed the dimensions; re-probe and record them on
		// both the item and its `original` file row.
		const after = await probeVideo(join(ctx.mediaPath, originalKey));
		ctx.db
			.update(schema.items)
			.set({ width: after.width, height: after.height })
			.where(eq(schema.items.id, itemId))
			.run();
		ctx.db
			.update(schema.itemFiles)
			.set({ mime: 'video/mp4', width: after.width, height: after.height })
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'original')))
			.run();
		await removeStalePlayback(ctx, itemId);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};
