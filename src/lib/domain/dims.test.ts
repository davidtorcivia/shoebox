import { describe, expect, it } from 'vitest';
import { fitWithin } from './dims';

describe('fitWithin', () => {
	it('keeps dimensions that are already within the max width', () => {
		expect(fitWithin(400, 300, 800)).toEqual({ width: 400, height: 300 });
	});

	it('scales width and height proportionally', () => {
		expect(fitWithin(1920, 1080, 400)).toEqual({ width: 400, height: 225 });
	});

	it('rounds scaled height', () => {
		expect(fitWithin(1000, 333, 400)).toEqual({ width: 400, height: 133 });
	});

	it('rejects invalid dimensions', () => {
		expect(() => fitWithin(0, 100, 400)).toThrow();
		expect(() => fitWithin(100, 100, 0)).toThrow();
	});
});
