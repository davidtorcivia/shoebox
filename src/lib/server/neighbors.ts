import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { items } from '$lib/server/db/schema';

type Db = App.Locals['db'];

export type NeighborContext = {
	people?: string[];
	tags?: string[];
	type?: 'video' | 'photo';
	album?: string;
};

/**
 * List-context params carried on /item/[id] URLs. `y` is only a timeline scroll
 * position, so prev/next navigation deliberately crosses year boundaries.
 */
export function contextFromParams(sp: URLSearchParams): NeighborContext {
	const ctx: NeighborContext = {};
	const people = csvParam(sp, 'people');
	const tags = csvParam(sp, 'tags');
	const type = sp.get('type');
	const album = sp.get('album')?.trim();

	if (people) ctx.people = people;
	if (tags) ctx.tags = tags;
	if (type === 'video' || type === 'photo') ctx.type = type;
	if (album) ctx.album = album;

	return ctx;
}

const SORT_KEY = sql<string>`coalesce(${items.sortDate}, '9999-12-31')`;

function csvParam(sp: URLSearchParams, key: string): string[] | undefined {
	const values = sp
		.get(key)
		?.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return values && values.length > 0 ? values : undefined;
}

function baseConditions(ctx: NeighborContext): SQL[] {
	const conditions: SQL[] = [eq(items.status, 'ready'), isNull(items.deletedAt)];

	if (ctx.type) conditions.push(eq(items.type, ctx.type));
	for (const personId of ctx.people ?? []) {
		conditions.push(
			sql`exists (select 1 from item_people ip where ip.item_id = ${items.id} and ip.person_id = ${personId})`
		);
	}
	for (const tagId of ctx.tags ?? []) {
		conditions.push(
			sql`exists (select 1 from item_tags it where it.item_id = ${items.id} and it.tag_id = ${tagId})`
		);
	}
	if (ctx.album) {
		conditions.push(
			sql`exists (select 1 from album_items ai where ai.item_id = ${items.id} and ai.album_id = ${ctx.album})`
		);
	}

	return conditions;
}

export async function neighborsOf(
	db: Db,
	itemId: string,
	ctx: NeighborContext
): Promise<{ prevId: string | null; nextId: string | null }> {
	const [current] = await db
		.select({ id: items.id, sortDate: items.sortDate })
		.from(items)
		.where(eq(items.id, itemId))
		.limit(1);
	if (!current) return { prevId: null, nextId: null };

	const currentKey = current.sortDate ?? '9999-12-31';
	const conditions = baseConditions(ctx);

	const [next] = await db
		.select({ id: items.id })
		.from(items)
		.where(
			and(
				...conditions,
				sql`(${SORT_KEY} > ${currentKey} or (${SORT_KEY} = ${currentKey} and ${items.id} > ${itemId}))`
			)
		)
		.orderBy(asc(SORT_KEY), asc(items.id))
		.limit(1);

	const [prev] = await db
		.select({ id: items.id })
		.from(items)
		.where(
			and(
				...conditions,
				sql`(${SORT_KEY} < ${currentKey} or (${SORT_KEY} = ${currentKey} and ${items.id} < ${itemId}))`
			)
		)
		.orderBy(desc(SORT_KEY), desc(items.id))
		.limit(1);

	return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}
