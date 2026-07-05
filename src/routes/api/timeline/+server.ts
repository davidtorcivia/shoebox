import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { yearCounts } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
	const years = await locals.db
		.select({ year: yearCounts.year, count: sql<number>`sum(${yearCounts.count})` })
		.from(yearCounts)
		.groupBy(yearCounts.year)
		.orderBy(yearCounts.year);
	return json({
		years,
		earliest: years[0]?.year ?? null,
		latest: years.at(-1)?.year ?? null
	});
};
