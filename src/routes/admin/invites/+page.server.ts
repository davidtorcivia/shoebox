import { createInvite, listInvites, revokeInvite, type InviteRole } from '$lib/server/invites';
import { requireRole } from '$lib/server/roles';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const INVITE_ROLES: InviteRole[] = ['admin', 'editor', 'uploader', 'user'];

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'admin');
	return { invites: await listInvites(locals.db), origin: url.origin };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const admin = requireRole(locals, 'admin');
		const data = await request.formData();
		const role = String(data.get('role') ?? '');
		if (!INVITE_ROLES.includes(role as InviteRole)) {
			return fail(400, { message: 'Pick a role.' });
		}
		const maxUsesRaw = Number.parseInt(String(data.get('maxUses') ?? '1'), 10);
		const maxUses = Number.isInteger(maxUsesRaw) && maxUsesRaw > 0 ? maxUsesRaw : 1;
		const daysRaw = Number.parseInt(String(data.get('expiresInDays') ?? ''), 10);
		const expiresAt =
			Number.isInteger(daysRaw) && daysRaw > 0 ? new Date(Date.now() + daysRaw * 86_400_000) : null;
		await createInvite(locals.db, {
			role: role as InviteRole,
			createdBy: admin.id,
			expiresAt,
			maxUses
		});
		return { created: true };
	},
	revoke: async ({ locals, request }) => {
		requireRole(locals, 'admin');
		const data = await request.formData();
		await revokeInvite(locals.db, String(data.get('id') ?? ''));
		return { revoked: true };
	}
};
