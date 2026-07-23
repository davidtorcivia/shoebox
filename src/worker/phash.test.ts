import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dhashFromGray, durationsCompatible, hammingHex64, imagePhash } from './phash';

function gradient(width: number, height: number, tilt: number): Promise<Buffer> {
	const pixels = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const value = Math.min(255, Math.round((x / width) * 255 + y * tilt));
			pixels.writeUInt8(value, (y * width + x) * 3);
			pixels.writeUInt8(value, (y * width + x) * 3 + 1);
			pixels.writeUInt8(value, (y * width + x) * 3 + 2);
		}
	}
	return sharp(pixels, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

describe('phash', () => {
	it('dhash is stable across scale and mild noise, distinct for different content', async () => {
		const a = await imagePhash(await gradient(320, 240, 0));
		const aScaled = await imagePhash(await gradient(640, 480, 0));
		const b = await imagePhash(await gradient(320, 240, 8));

		expect(hammingHex64(a, aScaled)).toBeLessThanOrEqual(2);
		expect(hammingHex64(a, b)).toBeGreaterThan(6);
	});

	it('dhash rejects wrong buffer sizes and emits 16 hex chars', () => {
		expect(() => dhashFromGray(new Uint8Array(10))).toThrow();
		const flat = dhashFromGray(new Uint8Array(72));
		expect(flat).toMatch(/^[0-9a-f]{16}$/);
	});

	it('hamming distance counts differing bits', () => {
		expect(hammingHex64('0000000000000000', '0000000000000000')).toBe(0);
		expect(hammingHex64('0000000000000000', '0000000000000001')).toBe(1);
		expect(hammingHex64('0000000000000000', 'ffffffffffffffff')).toBe(64);
	});

	it('duration compatibility allows small drift, rejects different clips', () => {
		expect(durationsCompatible(240, 240.5)).toBe(true);
		expect(durationsCompatible(240, 244)).toBe(true);
		expect(durationsCompatible(240, 30)).toBe(false);
		expect(durationsCompatible(null, 240)).toBe(true);
	});
});
