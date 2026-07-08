import { onThisDay } from '$lib/server/on-this-day';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'user');
	const now = new Date();
	const groups = await onThisDay(locals.db, locals.platform.storage, now);
	const monthDay = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
	return { groups, monthDay };
};
