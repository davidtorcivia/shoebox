/**
 * Perceptual hashing for "is this the same footage?" matching. dHash: shrink to
 * 9x8 grayscale, emit one bit per horizontal neighbor comparison — 64 bits that
 * survive re-encoding, scaling, and mild color shifts, unlike a byte hash.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { runFfmpeg } from './derivatives';

/** dHash over a 9x8 single-channel raw buffer, as 16 hex chars. */
export function dhashFromGray(pixels: Uint8Array): string {
	if (pixels.length !== 72) throw new Error(`expected 9x8 gray raw, got ${pixels.length} bytes`);
	let bits = 0n;
	for (let y = 0; y < 8; y += 1) {
		for (let x = 0; x < 8; x += 1) {
			bits <<= 1n;
			if (pixels[y * 9 + x] < pixels[y * 9 + x + 1]) bits |= 1n;
		}
	}
	return bits.toString(16).padStart(16, '0');
}

export async function imagePhash(path: string | Buffer): Promise<string> {
	const raw = await sharp(path).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
	return dhashFromGray(raw);
}

/** dHash of the frame at `atSeconds` (clamped to the clip by the caller). */
export async function videoFramePhash(path: string, atSeconds: number): Promise<string> {
	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-phash-'));
	try {
		const framePng = join(tmp, 'frame.png');
		await runFfmpeg(
			(cmd) => cmd.seekInput(Math.max(0, atSeconds)).outputOptions(['-frames:v 1']),
			path,
			framePng
		);
		return await imagePhash(framePng);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

/** Hamming distance between two 16-hex-char dHashes. */
export function hammingHex64(a: string, b: string): number {
	let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
	let count = 0;
	while (x > 0n) {
		count += Number(x & 1n);
		x >>= 1n;
	}
	return count;
}

/** Distance at or under which two hashes are treated as the same footage. */
export const PHASH_MATCH_DISTANCE = 6;

/** Whether two durations plausibly describe the same clip (re-renders can trim
 * a frame or two; unrelated clips rarely land this close by chance alone). */
export function durationsCompatible(a: number | null, b: number | null): boolean {
	if (a == null || b == null) return true; // photos, or unprobed → rely on phash
	return Math.abs(a - b) <= Math.max(2, 0.02 * Math.max(a, b));
}
