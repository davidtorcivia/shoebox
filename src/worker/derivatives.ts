import { and, eq, inArray } from 'drizzle-orm';
import { encode as blurhashEncode } from 'blurhash';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { nanoid } from 'nanoid';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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

type DerivedKind =
	'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite' | 'playback' | 'hls';

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
): { item: typeof schema.items.$inferSelect; originalKey: string; originalMime: string } {
	const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
	if (!item) throw new Error(`item ${itemId} not found`);

	const original = db
		.select()
		.from(schema.itemFiles)
		.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'original')))
		.get();
	if (!original) throw new Error(`item ${itemId} has no original file row`);

	return { item, originalKey: original.storageKey, originalMime: original.mime };
}

/** Camera RAW MIME types (as detected by file-type) whose pixels sharp cannot
 * decode directly. We extract the embedded JPEG preview with exiftool instead. */
const RAW_MIME = new Set([
	'image/x-canon-cr2',
	'image/x-canon-cr3',
	'image/x-nikon-nef',
	'image/x-sony-arw',
	'image/x-adobe-dng',
	'image/x-panasonic-rw2',
	'image/x-fujifilm-raf',
	'image/x-olympus-orf'
]);

export function isRawImage(mime: string): boolean {
	return RAW_MIME.has(mime);
}

/**
 * Returns a buffer sharp can decode. JPEG/PNG/WebP/AVIF/HEIC are read straight
 * off disk (sharp's libheif handles HEIC). Camera RAW has no sharp decoder, so
 * we pull the full-size JPEG preview every RAW embeds via exiftool.
 */
async function decodeToSharpSource(originalAbs: string, mime: string): Promise<Buffer> {
	if (!isRawImage(mime)) return readFile(originalAbs);
	return extractEmbeddedPreview(originalAbs);
}

async function extractEmbeddedPreview(originalAbs: string): Promise<Buffer> {
	// Prefer the largest preview (JpgFromRaw is typically full resolution),
	// falling back to progressively smaller embedded images.
	for (const tag of ['-JpgFromRaw', '-PreviewImage', '-OtherImage', '-ThumbnailImage']) {
		const out = await runExiftool(['-b', tag, originalAbs]).catch(() => null);
		if (out && out.byteLength > 0) return out;
	}
	throw new Error(`no embedded preview found in RAW ${originalAbs}`);
}

function runExiftool(args: string[]): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile(
			'exiftool',
			args,
			{ encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: FFPROBE_TIMEOUT_MS },
			(err, stdout) => {
				if (err) reject(err);
				else resolve(stdout as unknown as Buffer);
			}
		);
	});
}

/** Small, cheap blurhash used as the timeline placeholder. Best-effort. */
async function computeBlurhash(source: Buffer): Promise<string | null> {
	try {
		const { data, info } = await sharp(source)
			.rotate()
			.resize(32, 32, { fit: 'inside', withoutEnlargement: true })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		return blurhashEncode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
	} catch {
		return null;
	}
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
	const { item, originalKey, originalMime } = loadItem(ctx.db, itemId);
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
			// HEIC decodes through sharp's libheif; camera RAW is decoded from its
			// embedded JPEG preview. Either way `thumbSource` is a sharp-readable buffer.
			thumbSource = await decodeToSharpSource(originalAbs, originalMime);
			const meta = await sharp(thumbSource).metadata();
			let width = meta.width ?? 0;
			let height = meta.height ?? 0;
			if ((meta.orientation ?? 1) >= 5) {
				[width, height] = [height, width];
			}
			if (width > 0 && height > 0 && (item.width !== width || item.height !== height)) {
				ctx.db.update(schema.items).set({ width, height }).where(eq(schema.items.id, itemId)).run();
			}
			// The browser could not blurhash HEIC/RAW client-side; fill it in now so
			// the timeline has a placeholder. Web-safe photos already carry one.
			if (!item.blurhash) {
				const hash = await computeBlurhash(thumbSource);
				if (hash) {
					ctx.db
						.update(schema.items)
						.set({ blurhash: hash })
						.where(eq(schema.items.id, itemId))
						.run();
				}
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

/** Drop a `playback` derivative that no longer has a reason to exist (the
 * original is web-safe, e.g. after the source file was re-uploaded), so re-runs
 * converge instead of serving a stale encode. */
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
 * archival codecs) is not decodable in browsers. Storage policy is **keep-both**:
 * the camera master stays untouched as `original` (it remains the download and
 * the source for HLS/clip encodes), and the H.264 encode is written as a
 * separate `playback` derivative the player falls back to when there is no HLS.
 * No-op for photos or already web-safe videos.
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
		const outMp4 = join(tmp, 'playback.mp4');
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
					// Cap the long edge at 1080p — this file is the progressive fallback;
					// full-resolution playback rides the HLS ladder. Even dimensions (-2)
					// are mandatory for yuv420p H.264.
					"-vf scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p",
					'-c:a aac',
					'-b:a 160k',
					'-movflags +faststart'
				]),
			originalAbs,
			outMp4,
			TRANSCODE_TIMEOUT_MS
		);

		const playbackKey = `media/${itemId}/playback.mp4`;
		const data = await readFile(outMp4);
		await ctx.storage.put(playbackKey, new Uint8Array(data), { contentType: 'video/mp4' });

		const after = await probeVideo(join(ctx.mediaPath, playbackKey));
		replaceItemFiles(ctx.db, itemId, [
			{
				kind: 'playback',
				storageKey: playbackKey,
				mime: 'video/mp4',
				width: after.width,
				height: after.height
			}
		]);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};

export interface HlsRung {
	height: number;
	width: number;
	maxrateK: number;
	bandwidth: number;
}

/** Per-rung H.264 bitrate ceilings (kbit/s). Bounds each rung's size so the
 * ladder can't balloon the library — CRF still lets simple footage come in well
 * under these caps. */
const HLS_MAXRATE_K: Record<number, number> = {
	2160: 16000,
	1440: 9000,
	1080: 4500,
	720: 2500,
	480: 1200
};

/**
 * Storage-conscious HLS ladder. Videos shorter than 720p get none — they stream
 * fine as a single file and a segmented ladder would only multiply bytes. Above
 * that the top rung sits at the source resolution (capped at 4K, never
 * upscaled), so high-res footage actually plays at full quality where bandwidth
 * allows instead of being pinned to 1080p.
 */
export function hlsLadder(srcW: number, srcH: number): HlsRung[] {
	if (srcW <= 0 || srcH < 720) return [];
	const capped = Math.min(srcH, 2160);
	const heights = [2160, 1440, 1080, 720, 480].filter((h) => h <= capped);
	// Guarantee a lower rung to actually adapt to (e.g. an exactly-720p source).
	if (heights.length === 1 && capped > 480) heights.push(480);
	// At most four encodes: for a 4K source drop the 1440p intermediate —
	// 2160/1080/720/480 spans the bandwidth range without a fifth pass.
	while (heights.length > 4) heights.splice(1, 1);
	return heights.map((height) => {
		const width = Math.round((srcW * height) / srcH / 2) * 2;
		const maxrateK = HLS_MAXRATE_K[height] ?? 1200;
		return { height, width, maxrateK, bandwidth: maxrateK * 1000 + 128_000 };
	});
}

function hlsContentType(name: string): string {
	if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
	if (name.endsWith('.ts')) return 'video/mp2t';
	return 'application/octet-stream';
}

/**
 * Build an adaptive HLS ladder for larger videos. Each rung is re-encoded to
 * H.264 (so the source codec is irrelevant) and segmented; a master playlist
 * ties them together. The original file is untouched and remains the download.
 */
export const hlsHandler: JobHandler = async (payload, ctx) => {
	const itemId = String(payload.itemId ?? '');
	const { item, originalKey } = loadItem(ctx.db, itemId);
	if (item.type !== 'video') return;

	const originalAbs = join(ctx.mediaPath, originalKey);
	const probe = await probeVideo(originalAbs);
	const rungs = hlsLadder(probe.width, probe.height);
	if (rungs.length === 0) return;

	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-hls-'));
	try {
		for (const rung of rungs) {
			await runFfmpeg(
				(cmd) =>
					cmd.outputOptions([
						'-map 0:v:0',
						'-map 0:a:0?',
						'-c:v libx264',
						'-preset veryfast',
						'-crf 22',
						`-maxrate ${rung.maxrateK}k`,
						`-bufsize ${rung.maxrateK * 2}k`,
						`-vf scale=-2:${rung.height}:flags=lanczos,format=yuv420p`,
						'-c:a aac',
						'-b:a 128k',
						'-hls_time 6',
						'-hls_playlist_type vod',
						'-hls_flags independent_segments',
						`-hls_segment_filename ${join(tmp, `${rung.height}p_%03d.ts`)}`
					]),
				originalAbs,
				join(tmp, `${rung.height}p.m3u8`),
				TRANSCODE_TIMEOUT_MS
			);
			// ffmpeg writes absolute segment paths into the playlist; rewrite them to
			// bare filenames so the URIs resolve next to the playlist when served.
			const playlistPath = join(tmp, `${rung.height}p.m3u8`);
			const text = await readFile(playlistPath, 'utf8');
			const relative = text
				.split('\n')
				.map((line) => (line.startsWith('#') || line.trim() === '' ? line : basename(line.trim())))
				.join('\n');
			await writeFile(playlistPath, relative);
		}

		const master = ['#EXTM3U', '#EXT-X-VERSION:3'];
		for (const rung of rungs) {
			master.push(
				`#EXT-X-STREAM-INF:BANDWIDTH=${rung.bandwidth},RESOLUTION=${rung.width}x${rung.height}`
			);
			master.push(`${rung.height}p.m3u8`);
		}
		await writeFile(join(tmp, 'master.m3u8'), master.join('\n') + '\n');

		const dir = `media/${itemId}/hls`;
		for (const name of await readdir(tmp)) {
			const data = await readFile(join(tmp, name));
			await ctx.storage.put(`${dir}/${name}`, new Uint8Array(data), {
				contentType: hlsContentType(name)
			});
		}

		replaceItemFiles(ctx.db, itemId, [
			{
				kind: 'hls',
				storageKey: `${dir}/master.m3u8`,
				mime: 'application/vnd.apple.mpegurl',
				width: rungs[0].width,
				height: rungs[0].height
			}
		]);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};
