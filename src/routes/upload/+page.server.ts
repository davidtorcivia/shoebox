import { asc } from 'drizzle-orm';
import { people } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { PersonListDTO } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'uploader');
	const rows: PersonListDTO[] = await locals.db
		.select({
			id: people.id,
			name: people.name,
			birthdate: people.birthdate,
			deathDate: people.deathDate,
			birthPlace: people.birthPlace,
			accentColor: people.accentColor,
			avatarItemId: people.avatarItemId
		})
		.from(people)
		.orderBy(asc(people.name));
	return { people: rows };
};
