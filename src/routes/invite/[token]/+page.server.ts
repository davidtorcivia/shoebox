import { createSession, setSessionCookie } from '$lib/server/auth';
import { getInviteByToken, inviteState, redeemInvite } from '$lib/server/invites';
import { rateLimit, resetRateLimit } from '$lib/server/rate-limit';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Per-IP cap to deter invite-token enumeration from a single host. Lenient,
// since tokens are unguessable nanoids and a real invitee submits at most a
// couple of times; the window is cleared once an invite is successfully redeemed.
const INVITE_IP_LIMIT = 20;
const INVITE_IP_WINDOW_MS = 5 * 60_000;

const REASON_MESSAGES: Record<string, string> = {
	expired: 'This invite has expired. Ask for a new link.',
	exhausted: 'This invite has already been used up. Ask for a new link.',
	invalid: 'This invite link is not valid.',
	username_taken: 'That username is taken - pick another.',
	bad_username: 'Username must be 3-32 characters: letters, numbers, dots, dashes, underscores.',
	bad_password: 'Password must be at least 8 characters.'
};

export const load: PageServerLoad = async ({ params, locals }) => {
	if (locals.user) redirect(303, '/');
	const invite = await getInviteByToken(locals.db, params.token);
	const state = inviteState(invite);
	return { state, role: state === 'valid' ? invite!.role : null };
};

export const actions: Actions = {
	default: async ({ request, params, cookies, locals, getClientAddress }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');
		const ipKey = `invite:${getClientAddress()}`;
		if (!rateLimit(ipKey, { limit: INVITE_IP_LIMIT, windowMs: INVITE_IP_WINDOW_MS }).ok) {
			return fail(429, { message: 'Too many attempts. Wait a few minutes and try again.' });
		}
		const result = await redeemInvite(locals.db, params.token, { username, password });
		if (!result.ok) {
			return fail(400, { message: REASON_MESSAGES[result.reason] });
		}
		resetRateLimit(ipKey);
		const { token, expiresAt } = await createSession(locals.db, result.user.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/');
	}
};
