import { describe, expect, it } from 'vitest';
import {
	DOUBLE_TAP_SCALE,
	MAX_SCALE,
	MIN_SCALE,
	clampOffset,
	clampScale,
	pinchScale,
	toggleZoom
} from './zoom-math';

describe('clampScale and toggleZoom', () => {
	it('bounds scale from one to four', () => {
		expect(MIN_SCALE).toBe(1);
		expect(MAX_SCALE).toBe(4);
		expect(clampScale(0.3)).toBe(1);
		expect(clampScale(9)).toBe(4);
		expect(clampScale(2)).toBe(2);
	});

	it('toggles double-tap zoom between rest and 2.5x', () => {
		expect(toggleZoom(1)).toBe(DOUBLE_TAP_SCALE);
		expect(toggleZoom(2.5)).toBe(1);
		expect(toggleZoom(3.7)).toBe(1);
	});
});

describe('pinchScale', () => {
	it('scales by pointer-distance ratio and clamps', () => {
		expect(pinchScale(1, 100, 200)).toBe(2);
		expect(pinchScale(2, 100, 50)).toBe(1);
		expect(pinchScale(3, 100, 400)).toBe(4);
	});

	it('guards a zero start distance', () => {
		expect(pinchScale(2, 0, 300)).toBe(2);
	});
});

describe('clampOffset', () => {
	it('prevents panning when content fits the viewport', () => {
		expect(clampOffset(50, 1, 800, 600)).toBe(0);
	});

	it('clamps to half the overflow', () => {
		expect(clampOffset(500, 2, 800, 600)).toBe(200);
		expect(clampOffset(-500, 2, 800, 600)).toBe(-200);
		expect(clampOffset(120, 2, 800, 600)).toBe(120);
	});
});
