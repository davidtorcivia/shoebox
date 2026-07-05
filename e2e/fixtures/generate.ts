import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_MP4 = join(here, 'clip.mp4');
export const FIXTURE_JPG = join(here, 'photo.jpg');

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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await generateFixtures();
	console.log('fixtures ready:', FIXTURE_MP4, FIXTURE_JPG);
}
