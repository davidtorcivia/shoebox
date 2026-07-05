import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE, verifyPassword } from '$lib/server/auth';
import {
	albums,
	comments,
	invites,
	items,
	people,
	sessions,
	shares,
	users
} from '$lib/server/db/schema';
import { changePassword, changeUsername, updateAppearance } from '$lib/server/profile';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const row = (
		await locals.db.select().from(users).where(eq(users.id, locals.user.id)).limit(1)
	)[0];
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
		const result = await changeUsername(
			locals.db,
			locals.user.id,
			String(fd.get('current') ?? ''),
			String(fd.get('username') ?? '')
		);
		if (!result.ok) return fail(400, { message: result.error });
		return { saved: 'account' };
	},

	password: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const result = await changePassword(
			locals.db,
			locals.user.id,
			String(fd.get('current') ?? ''),
			String(fd.get('next') ?? '')
		);
		if (!result.ok) return fail(400, { message: result.error });
		return { saved: 'password' };
	},

	appearance: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		try {
			await updateAppearance(locals.db, locals.user.id, {
				accentColor: String(fd.get('accentColor') ?? ''),
				theme: String(fd.get('theme') ?? 'system') as 'system' | 'dark' | 'light',
				comfortMode: fd.get('comfortMode') === 'on'
			});
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Invalid preference' });
		}
		return { saved: 'appearance' };
	},

	deleteAccount: async ({ cookies, locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (locals.user.role === 'owner') {
			return fail(400, { message: 'The owner account cannot be deleted.' });
		}

		const fd = await request.formData();
		const current = String(fd.get('current') ?? '');
		const row = (
			await locals.db.select().from(users).where(eq(users.id, locals.user.id)).limit(1)
		)[0];
		if (!row || !(await verifyPassword(current, row.passwordHash))) {
			return fail(400, { message: 'Current password is incorrect' });
		}

		const owner = (
			await locals.db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1)
		)[0];
		if (!owner || owner.id === locals.user.id) {
			return fail(400, { message: 'The owner account cannot be deleted.' });
		}

		await locals.db.update(items).set({ uploadedBy: owner.id }).where(eq(items.uploadedBy, row.id));
		await locals.db.update(albums).set({ createdBy: owner.id }).where(eq(albums.createdBy, row.id));
		await locals.db.update(comments).set({ userId: owner.id }).where(eq(comments.userId, row.id));
		await locals.db
			.update(invites)
			.set({ createdBy: owner.id })
			.where(eq(invites.createdBy, row.id));
		await locals.db.update(shares).set({ createdBy: owner.id }).where(eq(shares.createdBy, row.id));
		await locals.db.delete(sessions).where(eq(sessions.userId, row.id));
		await locals.db.delete(users).where(eq(users.id, row.id));

		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
