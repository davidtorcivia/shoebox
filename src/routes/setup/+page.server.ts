import { nextAccent } from '$lib/domain/accents';
import { createSession, hashPassword, setSessionCookie } from '$lib/server/auth';
import { users } from '$lib/server/db/schema';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import type { Actions } from './$types';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export const actions: Actions = {
	default: async ({ request, cookies, locals }) => {
		const existing = await locals.db.select({ id: users.id }).from(users).limit(1);
		if (existing.length > 0) redirect(303, '/login');

		const data = await request.formData();
		const username = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');
		if (!USERNAME_RE.test(username)) {
			return fail(400, {
				message: 'Username must be 3-32 characters: letters, numbers, dots, dashes, underscores.'
			});
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}

		const id = nanoid(12);
		await locals.db.insert(users).values({
			id,
			username,
			passwordHash: await hashPassword(password),
			role: 'owner',
			accentColor: nextAccent([]),
			personId: null,
			comfortMode: false,
			theme: 'system',
			createdAt: new Date()
		});

		const { token, expiresAt } = await createSession(locals.db, id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/');
	}
};
