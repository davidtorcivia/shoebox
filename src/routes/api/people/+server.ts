import { json } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { people } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { PersonListDTO } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
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
	return json({ people: rows });
};

