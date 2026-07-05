import { describe, expect, it } from 'vitest';
import { cropStyle, makePortraitCrop } from './crop';

describe('cropStyle', () => {
	it('scales and offsets so the crop region fills the container', () => {
		expect(cropStyle({ x: 0.25, y: 0.2, w: 0.5, h: 0.5 })).toBe(
			'width:200%;height:200%;left:-50%;top:-40%'
		);
	});

	it('is identity for the full-frame crop', () => {
		expect(cropStyle({ x: 0, y: 0, w: 1, h: 1 })).toBe(
			'width:100%;height:100%;left:0%;top:0%'
		);
	});
});

describe('makePortraitCrop', () => {
	it('locks pixel aspect to 4:5 on a square image', () => {
		const crop = makePortraitCrop(1000, 1000, 0.5, 0.5, 0.5);
		expect(crop.h).toBeCloseTo(0.5);
		expect(crop.w).toBeCloseTo(0.4);
		expect(crop.x).toBeCloseTo(0.3);
		expect(crop.y).toBeCloseTo(0.25);
	});

	it('locks pixel aspect on a landscape image', () => {
		const crop = makePortraitCrop(1600, 900, 0.8, 0.5, 0.5);
		expect((crop.w * 1600) / (crop.h * 900)).toBeCloseTo(0.8);
	});

	it('clamps the rect inside the image', () => {
		const crop = makePortraitCrop(1000, 1000, 0.5, 0.02, 0.98);
		expect(crop.x).toBeCloseTo(0);
		expect(crop.y).toBeCloseTo(0.5);
	});

	it('caps zoom when the requested height would overflow the width', () => {
		const crop = makePortraitCrop(400, 2000, 1, 0.5, 0.5);
		expect(crop.w).toBeLessThanOrEqual(1);
		expect((crop.w * 400) / (crop.h * 2000)).toBeCloseTo(0.8);
	});
});
