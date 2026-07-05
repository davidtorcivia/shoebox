import { createInvite, listInvites, type InviteRole } from '$lib/server/invites';
import { requireRole } from '$lib/server/roles';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const INVITE_ROLES: InviteRole[] = ['admin', 'editor', 'uploader', 'user'];

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'admin');
	return json({ invites: await listInvites(locals.db) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const admin = requireRole(locals, 'admin');
	const body = (await request.json()) as {
		role?: string;
		expiresInDays?: number;
		maxUses?: number;
	};
	if (!INVITE_ROLES.includes(body.role as InviteRole)) {
		return json({ message: 'role must be one of admin|editor|uploader|user' }, { status: 400 });
	}
	const maxUses = Number.isInteger(body.maxUses) && body.maxUses! > 0 ? body.maxUses! : 1;
	const expiresAt =
		typeof body.expiresInDays === 'number' && body.expiresInDays > 0
			? new Date(Date.now() + body.expiresInDays * 86_400_000)
			: null;
	const invite = await createInvite(locals.db, {
		role: body.role as InviteRole,
		createdBy: admin.id,
		expiresAt,
		maxUses
	});
	return json({ invite }, { status: 201 });
};
