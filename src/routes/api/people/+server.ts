import { error, json } from '@sveltejs/kit';
import { createPerson, listPeople } from '$lib/server/people';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
	return json({ people: await listPeople(locals.db, locals.platform.storage) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'editor');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.name !== 'string' || !body.name.trim()) error(400, 'name is required');
	const person = await createPerson(locals.db, {
		name: body.name.trim(),
		birthdate: typeof body.birthdate === 'string' ? body.birthdate : null,
		deathDate: typeof body.deathDate === 'string' ? body.deathDate : null,
		birthPlace: typeof body.birthPlace === 'string' ? body.birthPlace : null
	});
	return json({ person }, { status: 201 });
};
