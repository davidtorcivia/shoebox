import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';
import { load as indexLoad } from './+page.server';

const admin = {
	id: 'u_admin0000001',
	username: 'ada',
	role: 'admin',
	accentColor: '#FA7B62',
	personId: null,
	comfortMode: false,
	theme: 'system'
} as const;
const editor = { ...admin, role: 'editor' } as const;

function ev(user: typeof admin | typeof editor | null) {
	return {
		locals: { user, db: undefined as never, platform: undefined as never, shareTokens: [] }
	} as never;
}

describe('/admin guard', () => {
	it('403s editors', async () => {
		await expect(load(ev(editor))).rejects.toSatisfy(
			(err: unknown) => isHttpError(err) && err.status === 403
		);
	});

	it('401s signed-out', async () => {
		await expect(load(ev(null))).rejects.toSatisfy(
			(err: unknown) => isHttpError(err) && err.status === 401
		);
	});

	it('passes admins through with user data', async () => {
		expect(await load(ev(admin))).toEqual({ user: admin });
	});

	it('/admin redirects to /admin/users', async () => {
		await expect(indexLoad(ev(admin))).rejects.toSatisfy(
			(err: unknown) => isRedirect(err) && err.location === '/admin/users'
		);
	});
});
