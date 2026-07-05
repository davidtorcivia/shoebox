import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { users } from '$lib/server/db/schema';
import { getDb, getPlatform } from '$lib/server/platform';
import { SHARE_COOKIE_PREFIX, shareCookieValue } from '$lib/server/shares';
import { redirect, type Handle } from '@sveltejs/kit';

const PUBLIC_PREFIXES = ['/login', '/setup', '/invite', '/share', '/media'];

let setupComplete = false;

function isPublic(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.platform = await getPlatform(event);
	event.locals.db = await getDb(event);

	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await validateSession(event.locals.db, token) : null;

	const shareTokens: string[] = [];
	for (const { name, value } of event.cookies.getAll()) {
		if (!name.startsWith(SHARE_COOKIE_PREFIX)) continue;
		const shareToken = name.slice(SHARE_COOKIE_PREFIX.length);
		if (value === (await shareCookieValue(shareToken))) shareTokens.push(shareToken);
	}
	event.locals.shareTokens = shareTokens;

	if (!setupComplete) {
		const anyUser = await event.locals.db.select({ id: users.id }).from(users).limit(1);
		setupComplete = anyUser.length > 0;
	}

	const path = event.url.pathname;
	const isApi = path === '/api' || path.startsWith('/api/');

	if (!setupComplete && path !== '/setup' && !isApi) redirect(303, '/setup');
	if (setupComplete && path === '/setup') redirect(303, '/login');
	if (!event.locals.user && !isPublic(path) && !isApi) redirect(303, '/login');

	return resolve(event);
};
