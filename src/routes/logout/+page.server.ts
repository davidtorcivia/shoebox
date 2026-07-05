import { destroySession, SESSION_COOKIE } from '$lib/server/auth';
import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ cookies, locals }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await destroySession(locals.db, token);
		cookies.delete(SESSION_COOKIE, { path: '/', secure: !dev });
		redirect(303, '/login');
	}
};
