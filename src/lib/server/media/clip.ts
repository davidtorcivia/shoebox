// Node-only: extract a [start,end] segment of a video and return it as an MP4 or
// an animated GIF. Loaded via dynamic import (like poster.ts) so it never enters
// the Cloudflare bundle — clip export is a node-only feature.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { GIF_FPS, GIF_MAX_WIDTH, type ClipFormat } from '$lib/domain/clip';

const execFileAsync = promisify(execFile);
// Generous relative to the length caps (60s MP4 / 20s GIF) so a slow disk or a
// heavy GIF palette pass still completes, but a wedged ffmpeg is killed.
const CLIP_TIMEOUT_MS = 120_000;

export interface RenderClipOptions {
	mediaPath: string;
	sourceKey: string;
	start: number;
	end: number;
	format: ClipFormat;
}

export interface RenderedClip {
	data: Uint8Array;
	contentType: string;
	ext: string;
}

export async function renderClip(opts: RenderClipOptions): Promise<RenderedClip> {
	if (!ffmpegPath) throw new Error('ffmpeg binary unavailable');
	const sourceAbs = join(opts.mediaPath, opts.sourceKey);
	if (!existsSync(sourceAbs)) throw new Error(`source not found: ${sourceAbs}`);

	const start = Math.max(0, opts.start);
	const durationArg = Math.max(0.1, opts.end - opts.start);
	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-clip-'));
	try {
		if (opts.format === 'gif') {
			const out = join(tmp, 'clip.gif');
			// One-graph, two-pass palette: palettegen builds an optimal 256-colour
			// palette for the segment, paletteuse applies it with light dithering —
			// far better than ffmpeg's default GIF colours.
			const filter =
				`fps=${GIF_FPS},scale=${GIF_MAX_WIDTH}:-2:flags=lanczos,` +
				`split[s0][s1];[s0]palettegen=stats_mode=diff[p];` +
				`[s1][p]paletteuse=dither=bayer:bayer_scale=3`;
			await execFileAsync(
				ffmpegPath,
				[
					'-y',
					'-ss',
					String(start),
					'-t',
					String(durationArg),
					'-i',
					sourceAbs,
					'-vf',
					filter,
					'-loop',
					'0',
					out
				],
				{ timeout: CLIP_TIMEOUT_MS }
			);
			return { data: new Uint8Array(await readFile(out)), contentType: 'image/gif', ext: 'gif' };
		}

		const out = join(tmp, 'clip.mp4');
		// Re-encode (not stream-copy) so the cut is frame-accurate at both ends and
		// the result plays everywhere; +faststart moves the moov atom up front so it
		// streams/downloads without a full read. Input seek (-ss before -i) is fast.
		await execFileAsync(
			ffmpegPath,
			[
				'-y',
				'-ss',
				String(start),
				'-t',
				String(durationArg),
				'-i',
				sourceAbs,
				'-map',
				'0:v:0',
				'-map',
				'0:a:0?',
				'-c:v',
				'libx264',
				'-preset',
				'veryfast',
				'-crf',
				'20',
				'-vf',
				"scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p",
				'-c:a',
				'aac',
				'-b:a',
				'160k',
				'-movflags',
				'+faststart',
				out
			],
			{ timeout: CLIP_TIMEOUT_MS }
		);
		return { data: new Uint8Array(await readFile(out)), contentType: 'video/mp4', ext: 'mp4' };
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}
