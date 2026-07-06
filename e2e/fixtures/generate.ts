import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_MP4 = join(here, 'clip.mp4');
export const FIXTURE_JPG = join(here, 'photo.jpg');
export const FIXTURE_PNG = join(here, 'photo-1.png');
export const FIXTURE_PNG_2 = join(here, 'photo-2.png');
export const FIXTURE_PNG_3 = join(here, 'photo-3.png');
export const FIXTURE_WEBM = join(here, 'clip.webm');

const PNG_BACKGROUNDS: Array<{ r: number; g: number; b: number }> = [
	{ r: 250, g: 123, b: 98 },
	{ r: 98, g: 178, b: 250 },
	{ r: 156, g: 215, b: 130 }
];

async function generatePng(path: string, background: { r: number; g: number; b: number }): Promise<void> {
	const base = await sharp({
		create: { width: 640, height: 480, channels: 3, background }
	})
		.png()
		.toBuffer();
	// A deterministic off-center band so the three PNGs are visibly distinct.
	await sharp({
		create: { width: 640, height: 96, channels: 3, background: { r: 23, g: 20, b: 18 } }
	})
		.png()
		.toBuffer()
		.then((band) =>
			sharp(base).composite([{ input: band, top: 300, left: 0, blend: 'over' }]).png().toFile(path)
		);
}

export async function generateFixtures(): Promise<void> {
	mkdirSync(here, { recursive: true });

	if (!existsSync(FIXTURE_MP4)) {
		execFileSync(ffmpegPath as unknown as string, [
			'-y',
			'-f',
			'lavfi',
			'-i',
			'testsrc=duration=2:size=320x180:rate=12',
			'-f',
			'lavfi',
			'-i',
			'anullsrc=r=44100:cl=mono',
			'-shortest',
			'-c:v',
			'libx264',
			'-pix_fmt',
			'yuv420p',
			'-c:a',
			'aac',
			'-movflags',
			'+faststart',
			FIXTURE_MP4
		]);
	}

	if (!existsSync(FIXTURE_WEBM)) {
		// VP8 so Playwright Chromium can decode client-side for poster capture.
		execFileSync(ffmpegPath as unknown as string, [
			'-y',
			'-f',
			'lavfi',
			'-i',
			'testsrc=duration=2:size=320x180:rate=12',
			'-c:v',
			'libvpx',
			'-b:v',
			'128k',
			'-an',
			FIXTURE_WEBM
		]);
	}

	if (!existsSync(FIXTURE_JPG)) {
		await sharp({
			create: {
				width: 640,
				height: 480,
				channels: 3,
				background: { r: 250, g: 123, b: 98 }
			}
		})
			.jpeg({ quality: 80 })
			.withExif({
				IFD0: { Make: 'Shoebox' },
				IFD2: { DateTimeOriginal: '1994:12:25 10:30:00' }
			})
			.toFile(FIXTURE_JPG);
	}

	for (const [path, background] of [
		[FIXTURE_PNG, PNG_BACKGROUNDS[0]],
		[FIXTURE_PNG_2, PNG_BACKGROUNDS[1]],
		[FIXTURE_PNG_3, PNG_BACKGROUNDS[2]]
	] as const) {
		if (!existsSync(path)) await generatePng(path, background);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await generateFixtures();
	console.log('fixtures ready:', FIXTURE_MP4, FIXTURE_JPG);
}
