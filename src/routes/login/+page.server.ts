import { createSession, resetLoginAttempts, setSessionCookie, takeLoginAttempt, verifyPassword } from '$lib/server/auth';
import { users } from '$lib/server/db/schema';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, locals }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');
		if (!takeLoginAttempt(username)) {
			return fail(429, { message: 'Too many sign-in attempts. Wait a minute and try again.' });
		}
		const rows = await locals.db.select().from(users).where(eq(users.username, username)).limit(1);
		const row = rows[0];
		if (!row || !(await verifyPassword(password, row.passwordHash))) {
			return fail(400, { message: 'Wrong username or password.' });
		}
		resetLoginAttempts(username);
		const { token, expiresAt } = await createSession(locals.db, row.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/');
	}
};
