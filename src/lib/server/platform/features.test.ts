import { describe, expect, it } from 'vitest';
import { facesEnabled, platformFeatures } from './features';

describe('facesEnabled', () => {
	it('enables faces only when FACES_ENABLED is 1', () => {
		expect(facesEnabled({ FACES_ENABLED: '1' })).toBe(true);
		expect(facesEnabled({ FACES_ENABLED: '0' })).toBe(false);
		expect(facesEnabled({})).toBe(false);
	});

	it('keeps faces disabled on Cloudflare regardless of env', () => {
		expect(platformFeatures('cloudflare', { FACES_ENABLED: '1' }).faces).toBe(false);
	});

	it('preserves node-only feature defaults', () => {
		expect(platformFeatures('node', { FACES_ENABLED: '1' })).toEqual({
			ingestion: true,
			faces: true,
			serverDerivatives: true
		});
		expect(platformFeatures('node', {}).faces).toBe(false);
	});
});
