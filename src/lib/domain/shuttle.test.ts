import { describe, expect, it } from 'vitest';
import { RATES, SHUTTLE_PAUSED, nextRate, shuttleNext, togglePlay, type Shuttle } from './shuttle';

const fwd = (rate: 1 | 2): Shuttle => ({ mode: 'forward', rate });
const rev: Shuttle = { mode: 'reverse', rate: 2 };

describe('shuttleNext', () => {
	it('K always pauses', () => {
		expect(shuttleNext(fwd(2), 'K')).toEqual({ mode: 'pause' });
		expect(shuttleNext(rev, 'K')).toEqual({ mode: 'pause' });
		expect(shuttleNext(SHUTTLE_PAUSED, 'K')).toEqual({ mode: 'pause' });
	});

	it('L ramps forward playback', () => {
		expect(shuttleNext(SHUTTLE_PAUSED, 'L')).toEqual(fwd(1));
		expect(shuttleNext(fwd(1), 'L')).toEqual(fwd(2));
		expect(shuttleNext(fwd(2), 'L')).toEqual(fwd(2));
		expect(shuttleNext(rev, 'L')).toEqual(fwd(1));
	});

	it('J always reverses at x2', () => {
		expect(shuttleNext(SHUTTLE_PAUSED, 'J')).toEqual(rev);
		expect(shuttleNext(fwd(2), 'J')).toEqual(rev);
		expect(shuttleNext(rev, 'J')).toEqual(rev);
	});
});

describe('togglePlay', () => {
	it('toggles pause and forward playback', () => {
		expect(togglePlay(SHUTTLE_PAUSED)).toEqual(fwd(1));
		expect(togglePlay(fwd(2))).toEqual({ mode: 'pause' });
		expect(togglePlay(rev)).toEqual({ mode: 'pause' });
	});
});

describe('nextRate', () => {
	it('cycles the documented ladder', () => {
		expect(RATES).toEqual([0.5, 1, 1.5, 2]);
		expect(nextRate(0.5)).toBe(1);
		expect(nextRate(1)).toBe(1.5);
		expect(nextRate(1.5)).toBe(2);
		expect(nextRate(2)).toBe(0.5);
	});

	it('unknown rates reset to 1', () => {
		expect(nextRate(3)).toBe(1);
	});
});
