import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate';

describe('e2e fixtures', () => {
	it('generates a tiny mp4 and an EXIF-dated jpg', async () => {
		await generateFixtures();
		expect(statSync(FIXTURE_MP4).size).toBeGreaterThan(1000);
		expect(statSync(FIXTURE_JPG).size).toBeGreaterThan(500);
	});
});
