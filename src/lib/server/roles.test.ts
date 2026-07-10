import { describe, expect, it } from 'vitest';
import type { SessionUser } from './auth';
import { ROLE_RANK, requireRole } from './roles';

function userWith(role: SessionUser['role']): { user: SessionUser } {
	return {
		user: {
			id: 'u1',
			username: 'tester',
			role,
			accentColor: '#FA7B62',
			avatarStorageKey: null,
			personId: null,
			comfortMode: false,
			theme: 'system',
			tourVersion: 0
		}
	};
}

describe('ROLE_RANK', () => {
	it('ranks user < uploader < editor < admin < owner', () => {
		expect(ROLE_RANK).toEqual({ user: 0, uploader: 1, editor: 2, admin: 3, owner: 4 });
	});
});

describe('requireRole', () => {
	it('returns the user when rank is sufficient (including equal)', () => {
		expect(requireRole(userWith('editor'), 'editor').role).toBe('editor');
		expect(requireRole(userWith('owner'), 'user').username).toBe('tester');
	});

	it('throws 401 when signed out', () => {
		try {
			requireRole({ user: null }, 'user');
			expect.unreachable('should have thrown');
		} catch (e) {
			expect((e as { status: number }).status).toBe(401);
		}
	});

	it('throws 403 when rank is too low', () => {
		try {
			requireRole(userWith('uploader'), 'admin');
			expect.unreachable('should have thrown');
		} catch (e) {
			expect((e as { status: number }).status).toBe(403);
		}
	});
});
