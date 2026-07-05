import { ACCENTS } from '$lib/ui/tokens';
import { describe, expect, it } from 'vitest';
import { nextAccent } from './accents';

describe('nextAccent', () => {
	it('returns the first accent when nothing is used', () => {
		expect(nextAccent([])).toBe(ACCENTS[0].hex);
	});

	it('returns the first unused accent', () => {
		expect(nextAccent([ACCENTS[0].hex])).toBe(ACCENTS[1].hex);
		expect(nextAccent([ACCENTS[0].hex, ACCENTS[1].hex])).toBe(ACCENTS[2].hex);
	});

	it('wraps to the least-used when all are taken', () => {
		const allOnce = ACCENTS.map((a) => a.hex);
		expect(nextAccent(allOnce)).toBe(ACCENTS[0].hex);
		expect(nextAccent([...allOnce, ACCENTS[0].hex])).toBe(ACCENTS[1].hex);
	});

	it('ignores hexes that are not in the accent set', () => {
		expect(nextAccent(['#123456', 'not-a-color'])).toBe(ACCENTS[0].hex);
	});

	it('always returns a member of ACCENTS', () => {
		const hexes = new Set<string>(ACCENTS.map((a) => a.hex));
		expect(hexes.has(nextAccent([ACCENTS[3].hex, ACCENTS[3].hex]))).toBe(true);
	});
});
