import { error } from '@sveltejs/kit';
import type { SessionUser } from './auth';

export type Role = 'owner' | 'admin' | 'editor' | 'uploader' | 'user';

export const ROLE_RANK: Record<Role, number> = {
	user: 0,
	uploader: 1,
	editor: 2,
	admin: 3,
	owner: 4
};

export function requireRole(locals: { user: SessionUser | null }, min: Role): SessionUser {
	if (!locals.user) error(401, 'Not signed in');
	if (ROLE_RANK[locals.user.role] < ROLE_RANK[min]) error(403, 'Insufficient role');
	return locals.user;
}
