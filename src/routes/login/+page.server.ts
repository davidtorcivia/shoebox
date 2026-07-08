import {
	createSession,
	resetLoginAttempts,
	setSessionCookie,
	takeLoginAttempt,
	verifyPassword
} from '$lib/server/auth';
import { rateLimit, resetRateLimit } from '$lib/server/rate-limit';
import { users } from '$lib/server/db/schema';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

// Per-IP brute-force cap layered on top of the per-username limiter in auth.ts:
// even an attacker rotating usernames from one host is throttled. We count every
// attempt but clear the window on success (below) so a correct password never
// burns a legitimate user's budget.
const LOGIN_IP_LIMIT = 10;
const LOGIN_IP_WINDOW_MS = 5 * 60_000;

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, locals, getClientAddress }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');
		const ipKey = `login:${getClientAddress()}`;
		if (
			!rateLimit(ipKey, { limit: LOGIN_IP_LIMIT, windowMs: LOGIN_IP_WINDOW_MS }).ok ||
			!takeLoginAttempt(username)
		) {
			return fail(429, { message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
		}
		const rows = await locals.db.select().from(users).where(eq(users.username, username)).limit(1);
		const row = rows[0];
		if (!row || !(await verifyPassword(password, row.passwordHash))) {
			return fail(400, { message: 'Wrong username or password.' });
		}
		resetLoginAttempts(username);
		resetRateLimit(ipKey);
		const { token, expiresAt } = await createSession(locals.db, row.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/');
	}
};
