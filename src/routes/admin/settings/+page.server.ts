import { getSiteSettings, HOLIDAY_OPTIONS } from '$lib/server/admin-settings';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	return {
		settings: await getSiteSettings(locals.db),
		holidayOptions: HOLIDAY_OPTIONS,
		features: locals.platform.features
	};
};
