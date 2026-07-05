export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

export function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function toggleZoom(scale: number): number {
	return scale > 1.01 ? MIN_SCALE : DOUBLE_TAP_SCALE;
}

export function pinchScale(startScale: number, startDistance: number, distance: number): number {
	if (startDistance <= 0) return clampScale(startScale);
	return clampScale(startScale * (distance / startDistance));
}

export function clampOffset(
	offset: number,
	scale: number,
	viewport: number,
	content: number
): number {
	const max = Math.max(0, (content * scale - viewport) / 2);
	return Math.min(max, Math.max(-max, offset));
}
