import type { FaceBox } from '$lib/server/faces';
import { parseFaceBox as parseSharedFaceBox, requireFaces } from '$lib/server/faces-gate';
import { requireRole } from '$lib/server/roles';

export function requireFacesAdmin(locals: App.Locals): void {
	requireRole(locals, 'admin');
	requireFaces(locals.platform);
}

export function parseFaceBox(input: unknown): FaceBox {
	return parseSharedFaceBox(input);
}
