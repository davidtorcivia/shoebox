import { describe, expect, it } from 'vitest';
import { cropStyle } from './crop';

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
