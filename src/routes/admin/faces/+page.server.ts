import { error } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { people } from '$lib/server/db/schema';
import { listSuggestions } from '$lib/server/faces';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireFacesAdmin(locals);
	if (!locals.platform.features.faces) error(404, 'faces disabled');
	const allPeople = await locals.db
		.select({
			id: people.id,
			name: people.name,
			slug: people.slug,
			accentColor: people.accentColor
		})
		.from(people)
		.orderBy(asc(people.name));
	return {
		suggestions: await listSuggestions(locals.db, locals.platform.storage),
		people: allPeople
	};
};
