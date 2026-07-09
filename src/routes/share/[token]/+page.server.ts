import { error, fail, redirect, type Actions, type Cookies } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getItemDTO, getItemDTOsByIds } from '$lib/server/items';
import { listFavorites } from '$lib/server/favorites';
import { albumItems, albums } from '$lib/server/db/schema';
import {
	SHARE_COOKIE_MAX_AGE,
	SHARE_COOKIE_PREFIX,
	getShareByToken,
	resolveShare,
	shareCookieValue
} from '$lib/server/shares';
import { rateLimit, resetRateLimit } from '$lib/server/rate-limit';
import type { PageServerLoad } from './$types';

// Per token+IP cap layered on top of the per-token limiter inside resolveShare:
// throttles a single host guessing one share's password. Counts every attempt
// and clears on success so a correct password never leaves the visitor locked out.
const SHARE_IP_LIMIT = 10;
const SHARE_IP_WINDOW_MS = 5 * 60_000;

async function setShareCookie(cookies: Cookies, token: string, secure: boolean): Promise<void> {
	cookies.set(SHARE_COOKIE_PREFIX + token, await shareCookieValue(token), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: SHARE_COOKIE_MAX_AGE
	});
}

export const load: PageServerLoad = async ({ locals, params, cookies, url }) => {
	const token = params.token;
	if (!token) error(404, 'This share link does not exist.');
	const share = await getShareByToken(locals.db, token);
	if (!share) error(404, 'This share link does not exist.');
	if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
		return { state: 'expired' as const };
	}

	const authorized = !share.hasPassword || locals.shareTokens.includes(token);
	if (!authorized) return { state: 'password' as const };

	await setShareCookie(cookies, token, url.protocol === 'https:');

	if (share.targetType === 'favorites') {
		// targetId is the owner's user id; render their saved collection read-only.
		const items = await listFavorites(locals.db, locals.platform.storage, share.targetId);
		return {
			state: 'ok' as const,
			share: { token, targetType: 'favorites' as const, allowDownload: share.allowDownload },
			album: { id: 'saved', title: 'Saved', description: null },
			items
		};
	}

	if (share.targetType === 'album') {
		const album = (
			await locals.db
				.select()
				.from(albums)
				.where(and(eq(albums.id, share.targetId), isNull(albums.deletedAt)))
				.limit(1)
		)[0];
		if (!album) error(404, 'This album is no longer available.');

		const rows = await locals.db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.where(eq(albumItems.albumId, album.id))
			.orderBy(asc(albumItems.position));
		const items = await getItemDTOsByIds(
			locals.db,
			locals.platform.storage,
			rows.map((row) => row.itemId)
		);

		return {
			state: 'ok' as const,
			share: { token, targetType: 'album' as const, allowDownload: share.allowDownload },
			album: { id: album.id, title: album.title, description: album.description },
			items
		};
	}

	const item = await getItemDTO(locals.db, locals.platform.storage, share.targetId);
	if (!item) error(404, 'This memory is no longer available.');
	return {
		state: 'ok' as const,
		share: {
			token,
			targetType: 'item' as const,
			allowDownload: share.allowDownload,
			segment:
				share.segmentStart != null && share.segmentEnd != null
					? { start: share.segmentStart, end: share.segmentEnd }
					: null
		},
		album: null,
		items: [item]
	};
};

export const actions: Actions = {
	unlock: async ({ locals, params, request, cookies, url, getClientAddress }) => {
		const token = params.token;
		if (!token) error(404, 'This share link does not exist.');
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const ipKey = `share:${token}:${getClientAddress()}`;
		if (!rateLimit(ipKey, { limit: SHARE_IP_LIMIT, windowMs: SHARE_IP_WINDOW_MS }).ok) {
			return fail(429, { message: 'Too many tries. Wait a few minutes, then try again.' });
		}
		const result = await resolveShare(locals.db, token, password);
		if (result.ok) {
			resetRateLimit(ipKey);
			await setShareCookie(cookies, token, url.protocol === 'https:');
			redirect(303, `/share/${token}`);
		}

		if (result.reason === 'rate_limited') {
			return fail(429, { message: 'Too many tries. Wait a minute, then try again.' });
		}
		if (result.reason === 'wrong_password') {
			return fail(400, { message: 'That password is not right.' });
		}
		if (result.reason === 'password_required') {
			return fail(400, { message: 'Enter the password.' });
		}
		if (result.reason === 'expired') redirect(303, `/share/${token}`);

		error(404, 'This share link does not exist.');
	}
};
