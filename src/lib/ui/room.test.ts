import { describe, expect, it } from 'vitest';
import { chromeVars, alpha, hexToRgb } from './room';
import type { DecadePalette } from './tokens';

const palette: DecadePalette = {
	decade: 1990,
	stops: ['#F35336', '#FA7B62', '#FFD9A8'],
	pools: [],
	chromeOn: 'ink'
};

describe('hexToRgb', () => {
	it('parses hex colors', () => {
		expect(hexToRgb('#FA7B62')).toEqual({ r: 250, g: 123, b: 98 });
	});
});

describe('alpha', () => {
	it('returns an rgba string', () => {
		expect(alpha('#171412', 0.5)).toBe('rgba(23, 20, 18, 0.5)');
	});
});

describe('chromeVars', () => {
	it('derives readable timeline chrome variables', () => {
		expect(chromeVars(palette)['--timeline-chrome']).toBe('#171412');
		expect(chromeVars({ ...palette, chromeOn: 'cream' })['--timeline-chrome']).toBe('#FFF5E8');
	});
});

