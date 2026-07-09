// Node-only: extract a single video frame and (re)write the poster + thumbnail
// derivatives from it. Loaded via dynamic import from setItemPoster so it never
// enters the Cloudflare bundle — picking a video poster is a node-only feature.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import type { StorageAdapter } from '$lib/server/platform/types';

const execFileAsync = promisify(execFile);
const THUMB_WIDTHS = [400, 800, 1600] as const;
const WEBP_QUALITY = 82;
const FFMPEG_TIMEOUT_MS = 30_000;

/**
 * Extract the frame at `time` seconds and overwrite the poster + thumbnail webps
 * for `itemId` from it. Mirrors the worker's derivatives poster path, but runs
 * inline so the new frame is on disk the moment the request returns. Input
 * seeking (`-ss` before `-i`) keeps it fast even on large originals.
 */
export async function renderVideoPoster(opts: {
	mediaPath: string;
	originalKey: string;
	time: number;
	storage: StorageAdapter;
	itemId: string;
}): Promise<void> {
	if (!ffmpegPath) throw new Error('ffmpeg binary unavailable');
	const originalAbs = join(opts.mediaPath, opts.originalKey);
	if (!existsSync(originalAbs)) throw new Error(`original not found: ${originalAbs}`);

	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-poster-'));
	try {
		const framePng = join(tmp, 'frame.png');
		await execFileAsync(
			ffmpegPath,
			[
				'-y',
				'-ss',
				String(Math.max(0, opts.time)),
				'-i',
				originalAbs,
				'-frames:v',
				'1',
				'-vf',
				"scale='min(1600,iw)':-2",
				framePng
			],
			{ timeout: FFMPEG_TIMEOUT_MS }
		);

		const frame = await readFile(framePng);
		const poster = await sharp(frame).webp({ quality: WEBP_QUALITY }).toBuffer();
		await opts.storage.put(`media/${opts.itemId}/poster.webp`, new Uint8Array(poster), {
			contentType: 'image/webp'
		});
		for (const width of THUMB_WIDTHS) {
			const thumb = await sharp(frame)
				.resize({ width, withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer();
			await opts.storage.put(`media/${opts.itemId}/thumb_${width}.webp`, new Uint8Array(thumb), {
				contentType: 'image/webp'
			});
		}
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}
