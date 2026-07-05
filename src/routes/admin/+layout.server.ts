import { requireRole } from '$lib/server/roles';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = requireRole(locals, 'admin');
	return { user };
};
