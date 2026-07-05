import { requireRole } from '$lib/server/roles';
import { listItems } from '$lib/server/items';
import * as schema from '$lib/server/db/schema';
import { isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'editor');
	const { items } = await listItems(locals.db, locals.platform.storage, {
		status: 'needs_review',
		limit: 100
	});
	const people = await locals.db
		.select({ id: schema.people.id, name: schema.people.name, accentColor: schema.people.accentColor })
		.from(schema.people)
		.orderBy(schema.people.name);
	const albums = await locals.db
		.select({ id: schema.albums.id, title: schema.albums.title })
		.from(schema.albums)
		.where(isNull(schema.albums.deletedAt))
		.orderBy(schema.albums.title);

	return { items, people, albums, ingestionEnabled: locals.platform.features.ingestion };
};
