import { eq } from 'drizzle-orm';
import { people } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// If this account is linked to a person, surface that person's slug so the nav
	// can offer a "You" shortcut straight to their own page.
	let linkedPersonSlug: string | null = null;
	if (locals.user?.personId) {
		const [row] = await locals.db
			.select({ slug: people.slug })
			.from(people)
			.where(eq(people.id, locals.user.personId))
			.limit(1);
		linkedPersonSlug = row?.slug ?? null;
	}

	return {
		user: locals.user,
		linkedPersonSlug,
		pathname: url.pathname,
		features: locals.platform.features
	};
};
