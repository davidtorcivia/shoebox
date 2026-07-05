import type { CropRect } from '$lib/domain/people-dto';

export function cropStyle(crop: CropRect): string {
	const pct = (value: number) => `${Number((value * 100).toFixed(4))}%`;
	return [
		`width:${pct(1 / crop.w)}`,
		`height:${pct(1 / crop.h)}`,
		`left:${pct(-crop.x / crop.w)}`,
		`top:${pct(-crop.y / crop.h)}`
	].join(';');
}

const PORTRAIT_ASPECT = 168 / 210;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function makePortraitCrop(
	imgW: number,
	imgH: number,
	hFrac: number,
	cx: number,
	cy: number
): CropRect {
	const maxH = Math.min(1, imgW / (PORTRAIT_ASPECT * imgH));
	const h = clamp(hFrac, 0.1, maxH);
	const w = (PORTRAIT_ASPECT * h * imgH) / imgW;
	return {
		x: clamp(cx - w / 2, 0, 1 - w),
		y: clamp(cy - h / 2, 0, 1 - h),
		w,
		h
	};
}
