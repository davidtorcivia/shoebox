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
