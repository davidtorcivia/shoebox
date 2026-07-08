import { eq } from 'drizzle-orm';
import { people } from '$lib/server/db/schema';
import { countNeedsReview } from '$lib/server/items';
import { countOnThisDay } from '$lib/server/on-this-day';
import { ROLE_RANK } from '$lib/server/roles';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// If this account is linked to a person, surface that person's slug so the nav
	// (and the Shoebox wordmark) can jump straight to their own page.
	let linkedPersonSlug: string | null = null;
	if (locals.user?.personId) {
		const [row] = await locals.db
			.select({ slug: people.slug })
			.from(people)
			.where(eq(people.id, locals.user.personId))
			.limit(1);
		linkedPersonSlug = row?.slug ?? null;
	}

	// Only editors+ see arrivals, and only when something is actually waiting —
	// the nav entry hides itself when the queue is empty.
	const canReview = locals.user ? ROLE_RANK[locals.user.role] >= ROLE_RANK.editor : false;
	const arrivalsCount =
		canReview && locals.platform.features.ingestion ? await countNeedsReview(locals.db) : 0;

	// "On This Day" only surfaces on the timeline when there's actually something
	// to resurface today.
	const onThisDayCount = locals.user ? await countOnThisDay(locals.db, new Date()) : 0;

	return {
		user: locals.user,
		linkedPersonSlug,
		arrivalsCount,
		onThisDayCount,
		pathname: url.pathname,
		features: locals.platform.features
	};
};
