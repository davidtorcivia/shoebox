import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import { listItems } from '$lib/server/items';
import { replaceCandidatesFor } from '$lib/server/replace-media';
import * as schema from '$lib/server/db/schema';
import { inArray, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.platform.features.ingestion) throw error(404, 'Arrivals needs the ingestion worker');
	requireRole(locals, 'admin');
	const { items } = await listItems(locals.db, locals.platform.storage, {
		status: 'needs_review',
		limit: 100
	});
	// Re-ingested files that share a filename with a ready library item get a
	// "replace its media?" prompt instead of being cataloged from scratch.
	const arrivalRows =
		items.length > 0
			? await locals.db
					.select({
						id: schema.items.id,
						type: schema.items.type,
						ingestName: schema.items.ingestName,
						framePhash: schema.items.framePhash,
						duration: schema.items.duration
					})
					.from(schema.items)
					.where(
						inArray(
							schema.items.id,
							items.map((item) => item.id)
						)
					)
			: [];
	const replaceCandidates = await replaceCandidatesFor(
		locals.db,
		locals.platform.storage,
		arrivalRows
	);
	const people = await locals.db
		.select({
			id: schema.people.id,
			name: schema.people.name,
			accentColor: schema.people.accentColor
		})
		.from(schema.people)
		.orderBy(schema.people.name);
	const albums = await locals.db
		.select({ id: schema.albums.id, title: schema.albums.title })
		.from(schema.albums)
		.where(isNull(schema.albums.deletedAt))
		.orderBy(schema.albums.title);

	return {
		items,
		people,
		albums,
		replaceCandidates,
		ingestionEnabled: locals.platform.features.ingestion,
		canCreatePeople: true
	};
};
