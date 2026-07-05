import { error } from '@sveltejs/kit';
import type { FaceBox } from '$lib/server/faces';
import { requireRole } from '$lib/server/roles';

export function requireFacesAdmin(locals: App.Locals): void {
	requireRole(locals, 'admin');
	if (!locals.platform.features.faces) error(404, 'faces disabled');
}

export function parseFaceBox(input: unknown): FaceBox {
	const box = input && typeof input === 'object' && 'box' in input ? input.box : input;
	if (!box || typeof box !== 'object') error(400, 'box is required');
	const maybe = box as Record<string, unknown>;
	return {
		x: Number(maybe.x),
		y: Number(maybe.y),
		w: Number(maybe.w),
		h: Number(maybe.h)
	};
}
