import { fail, redirect } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { people, users } from '$lib/server/db/schema';
import { ACCENTS } from '$lib/ui/tokens';
import type { Actions, PageServerLoad } from './$types';

const THEMES = ['system', 'dark', 'light'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const row = (await locals.db.select().from(users).where(eq(users.id, locals.user.id)).limit(1))[0];
	if (!row) redirect(302, '/login');

	let linkedPerson: { id: string; slug: string; name: string } | null = null;
	if (row.personId) {
		const person = (
			await locals.db
				.select({ id: people.id, slug: people.slug, name: people.name })
				.from(people)
				.where(eq(people.id, row.personId))
				.limit(1)
		)[0];
		if (person) linkedPerson = person;
	}

	return {
		profile: {
			username: row.username,
			role: row.role,
			accentColor: row.accentColor,
			theme: row.theme,
			comfortMode: row.comfortMode
		},
		linkedPerson
	};
};

export const actions: Actions = {
	account: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const username = String(fd.get('username') ?? '').trim();
		if (username.length < 3 || username.length > 32) {
			return fail(400, { message: 'Username must be 3-32 characters' });
		}
		const clash = (
			await locals.db
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.username, username), ne(users.id, locals.user.id)))
				.limit(1)
		)[0];
		if (clash) return fail(400, { message: 'That username is taken' });
		await locals.db.update(users).set({ username }).where(eq(users.id, locals.user.id));
		return { saved: 'account' };
	},

	password: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const current = String(fd.get('current') ?? '');
		const next = String(fd.get('next') ?? '');
		if (next.length < 8) return fail(400, { message: 'New password must be at least 8 characters' });
		const row = (await locals.db.select().from(users).where(eq(users.id, locals.user.id)).limit(1))[0];
		if (!row || !(await verifyPassword(current, row.passwordHash))) {
			return fail(400, { message: 'Current password is incorrect' });
		}
		await locals.db
			.update(users)
			.set({ passwordHash: await hashPassword(next) })
			.where(eq(users.id, locals.user.id));
		return { saved: 'password' };
	},

	appearance: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const accentColor = String(fd.get('accentColor') ?? '');
		const theme = String(fd.get('theme') ?? 'system');
		const comfortMode = fd.get('comfortMode') === 'on';
		if (!ACCENTS.some((accent) => accent.hex === accentColor)) {
			return fail(400, { message: 'Pick one of the accent swatches' });
		}
		if (!THEMES.includes(theme as (typeof THEMES)[number])) {
			return fail(400, { message: 'Invalid theme' });
		}
		await locals.db
			.update(users)
			.set({ accentColor, theme: theme as (typeof THEMES)[number], comfortMode })
			.where(eq(users.id, locals.user.id));
		return { saved: 'appearance' };
	}
};
