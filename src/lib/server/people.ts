import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { nextAccent } from '$lib/domain/accents';
import { ageAt } from '$lib/domain/ages';
import type {
	CropRect,
	FamilyRefs,
	PersonDetailDTO,
	PersonListDTO,
	PersonRef
} from '$lib/domain/people-dto';
import {
	canonicalRel,
	familyOf,
	inferRelationships,
	type Rel,
	type RelType
} from '$lib/domain/relationships';
import { ACCENTS } from '$lib/ui/tokens';
import type { Db } from '$lib/server/db';
import {
	albumItems,
	albums,
	itemFiles,
	itemPeople,
	items,
	people,
	relationships,
	users
} from '$lib/server/db/schema';
import type { StorageAdapter } from '$lib/server/platform/types';
import { reindexItemsForPerson } from '$lib/server/search';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function listPeople(db: Db, storage: StorageAdapter): Promise<PersonListDTO[]> {
	const rows = await db
		.select({
			id: people.id,
			slug: people.slug,
			name: people.name,
			accentColor: people.accentColor,
			birthdate: people.birthdate,
			deathDate: people.deathDate,
			avatarItemId: people.avatarItemId,
			avatarCrop: people.avatarCrop,
			itemCount: sql<number>`count(case when ${items.id} is not null and ${items.deletedAt} is null then 1 end)`
		})
		.from(people)
		.leftJoin(itemPeople, eq(itemPeople.personId, people.id))
		.leftJoin(items, eq(items.id, itemPeople.itemId))
		.groupBy(people.id);
	const urls = await avatarUrls(
		db,
		storage,
		rows.map((row) => row.avatarItemId).filter((id): id is string => Boolean(id)),
		'thumb_400'
	);

	return rows
		.map((row) => ({
			id: row.id,
			slug: row.slug,
			name: row.name,
			accentColor: row.accentColor,
			birthdate: row.birthdate,
			deathDate: row.deathDate,
			avatarItemId: row.avatarItemId,
			avatarCrop: parseCrop(row.avatarCrop),
			avatarUrl: row.avatarItemId ? (urls.get(row.avatarItemId) ?? null) : null,
			itemCount: Number(row.itemCount)
		}))
		.sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name));
}

export async function createPerson(
	db: Db,
	input: {
		name: string;
		birthdate?: string | null;
		deathDate?: string | null;
		birthPlace?: string | null;
	}
): Promise<PersonListDTO> {
	const name = input.name.trim();
	if (!name) error(400, 'name is required');
	for (const date of [input.birthdate, input.deathDate]) {
		if (date && !ISO_DATE.test(date)) error(400, 'dates must be ISO YYYY-MM-DD');
	}

	const used = [
		...(await db.select({ accentColor: users.accentColor }).from(users)).map(
			(row) => row.accentColor
		),
		...(await db.select({ accentColor: people.accentColor }).from(people)).map(
			(row) => row.accentColor
		)
	];
	const id = nanoid(12);
	const accentColor = nextAccent(used);
	const slug = await uniquePersonSlug(db, name);
	await db.insert(people).values({
		id,
		name,
		slug,
		birthdate: input.birthdate ?? null,
		deathDate: input.deathDate ?? null,
		birthPlace: input.birthPlace ?? null,
		accentColor,
		createdAt: new Date()
	});

	return {
		id,
		slug,
		name,
		accentColor,
		birthdate: input.birthdate ?? null,
		deathDate: input.deathDate ?? null,
		avatarItemId: null,
		avatarCrop: null,
		avatarUrl: null,
		itemCount: 0
	};
}

export async function resolveFamily(
	db: Db,
	storage: StorageAdapter,
	personId: string
): Promise<FamilyRefs> {
	const relRows = await db.select().from(relationships);
	const ids = familyOf(
		personId,
		relRows.map((row): Rel => ({ personA: row.personA, personB: row.personB, type: row.type }))
	);
	const all = [...new Set(Object.values(ids).flat())];
	const refs = new Map<string, PersonRef>();
	if (all.length > 0) {
		const rows = await db
			.select({
				id: people.id,
				slug: people.slug,
				name: people.name,
				accentColor: people.accentColor,
				avatarItemId: people.avatarItemId,
				avatarCrop: people.avatarCrop
			})
			.from(people)
			.where(inArray(people.id, all));
		const urls = await avatarUrls(
			db,
			storage,
			rows.map((row) => row.avatarItemId).filter((id): id is string => Boolean(id)),
			'thumb_400'
		);
		for (const row of rows) {
			refs.set(row.id, {
				id: row.id,
				slug: row.slug,
				name: row.name,
				accentColor: row.accentColor,
				avatarUrl: row.avatarItemId ? (urls.get(row.avatarItemId) ?? null) : null,
				avatarCrop: parseCrop(row.avatarCrop)
			});
		}
	}

	const pick = (list: string[]) =>
		list.map((id) => refs.get(id)).filter((person): person is PersonRef => Boolean(person));

	return {
		parents: pick(ids.parents),
		children: pick(ids.children),
		spouses: pick(ids.spouses),
		siblings: pick(ids.siblings),
		grandparents: pick(ids.grandparents),
		grandchildren: pick(ids.grandchildren)
	};
}

export async function getPersonDetail(
	db: Db,
	storage: StorageAdapter,
	id: string
): Promise<PersonDetailDTO | null> {
	const row = (await db.select().from(people).where(eq(people.id, id)).limit(1))[0];
	if (!row) return null;

	const liveTagged = and(
		eq(itemPeople.personId, id),
		isNull(items.deletedAt),
		eq(items.status, 'ready')
	);
	const yearExpr = sql<number>`cast(substr(${items.sortDate}, 1, 4) as integer)`;
	const yearRows = await db
		.select({
			year: yearExpr,
			count: sql<number>`count(*)`
		})
		.from(items)
		.innerJoin(itemPeople, eq(itemPeople.itemId, items.id))
		.where(and(liveTagged, sql`${items.sortDate} is not null`))
		.groupBy(yearExpr)
		.orderBy(yearExpr);
	const years = yearRows.map((yearRow) => ({
		year: Number(yearRow.year),
		count: Number(yearRow.count),
		age: row.birthdate ? ageAt(row.birthdate, `${yearRow.year}-07-01`, row.deathDate) : null
	}));

	const [{ moments }] = await db
		.select({ moments: sql<number>`count(*)` })
		.from(items)
		.innerJoin(itemPeople, eq(itemPeople.itemId, items.id))
		.where(liveTagged);
	const momentCount = Number(moments);

	const [{ albumCount }] = await db
		.select({ albumCount: sql<number>`count(distinct ${albumItems.albumId})` })
		.from(albumItems)
		.innerJoin(itemPeople, eq(itemPeople.itemId, albumItems.itemId))
		.innerJoin(albums, eq(albums.id, albumItems.albumId))
		.where(and(eq(itemPeople.personId, id), isNull(albums.deletedAt)));

	const linked = (
		await db.select({ username: users.username }).from(users).where(eq(users.personId, id)).limit(1)
	)[0];
	const urls = row.avatarItemId
		? await avatarUrls(db, storage, [row.avatarItemId], 'thumb_800')
		: new Map<string, string>();

	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		accentColor: row.accentColor,
		birthdate: row.birthdate,
		deathDate: row.deathDate,
		birthPlace: row.birthPlace,
		bio: row.bio,
		avatarItemId: row.avatarItemId,
		avatarCrop: parseCrop(row.avatarCrop),
		avatarUrl: row.avatarItemId ? (urls.get(row.avatarItemId) ?? null) : null,
		itemCount: momentCount,
		family: await resolveFamily(db, storage, id),
		years,
		stats: {
			moments: momentCount,
			onFilm: years.length ? { from: years[0].year, to: years[years.length - 1].year } : null,
			albums: Number(albumCount)
		},
		linkedUsername: linked?.username ?? null
	};
}

export async function resolvePersonId(db: Db, idOrSlug: string): Promise<string | null> {
	const row = (
		await db
			.select({ id: people.id })
			.from(people)
			.where(or(eq(people.id, idOrSlug), eq(people.slug, idOrSlug)))
			.limit(1)
	)[0];
	return row?.id ?? null;
}

export function parseCrop(raw: string | null): CropRect | null {
	if (!raw) return null;
	try {
		const crop = JSON.parse(raw) as Partial<CropRect>;
		return typeof crop.x === 'number' &&
			typeof crop.y === 'number' &&
			typeof crop.w === 'number' &&
			typeof crop.h === 'number'
			? { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
			: null;
	} catch {
		return null;
	}
}

async function avatarUrls(
	db: Db,
	storage: StorageAdapter,
	avatarItemIds: string[],
	kind: 'thumb_400' | 'thumb_800'
): Promise<Map<string, string>> {
	const ids = [...new Set(avatarItemIds)];
	const map = new Map<string, string>();
	if (ids.length === 0) return map;
	const rows = await db
		.select({ itemId: itemFiles.itemId, key: itemFiles.storageKey })
		.from(itemFiles)
		.where(and(inArray(itemFiles.itemId, ids), eq(itemFiles.kind, kind)));
	for (const row of rows) map.set(row.itemId, await storage.mediaUrl(row.key));
	return map;
}

export const PERSON_PATCH_KEYS = [
	'name',
	'birthdate',
	'deathDate',
	'birthPlace',
	'bio',
	'accentColor',
	'avatarItemId',
	'avatarCrop'
] as const;

export type PersonPatch = {
	name?: string;
	birthdate?: string | null;
	deathDate?: string | null;
	birthPlace?: string | null;
	bio?: string | null;
	accentColor?: string;
	avatarItemId?: string | null;
	avatarCrop?: CropRect | null;
};

export async function updatePerson(db: Db, id: string, patch: PersonPatch): Promise<void> {
	const row = (await db.select().from(people).where(eq(people.id, id)).limit(1))[0];
	if (!row) error(404, 'person not found');

	if (patch.name !== undefined && !patch.name.trim()) error(400, 'name must be non-empty');
	for (const date of [patch.birthdate, patch.deathDate]) {
		if (date != null && !ISO_DATE.test(date)) error(400, 'dates must be ISO YYYY-MM-DD');
	}
	if (
		patch.accentColor !== undefined &&
		!ACCENTS.some((accent) => accent.hex === patch.accentColor)
	) {
		error(400, 'accentColor must be one of the ACCENTS hexes');
	}
	if (patch.avatarItemId != null) {
		const tagged = await db
			.select({ itemId: itemPeople.itemId })
			.from(itemPeople)
			.where(and(eq(itemPeople.itemId, patch.avatarItemId), eq(itemPeople.personId, id)))
			.limit(1);
		if (tagged.length === 0) error(400, 'avatar item must be tagged with this person');
	}
	if (patch.avatarCrop != null && !validCrop(patch.avatarCrop)) error(400, 'invalid avatar crop');

	const set: Partial<typeof people.$inferInsert> = {};
	if (patch.name !== undefined) {
		set.name = patch.name.trim();
		set.slug = await uniquePersonSlug(db, set.name, id);
	}
	if (patch.birthdate !== undefined) set.birthdate = patch.birthdate;
	if (patch.deathDate !== undefined) set.deathDate = patch.deathDate;
	if (patch.birthPlace !== undefined) set.birthPlace = patch.birthPlace;
	if (patch.bio !== undefined) set.bio = patch.bio;
	if (patch.accentColor !== undefined) set.accentColor = patch.accentColor;
	if (patch.avatarItemId !== undefined) set.avatarItemId = patch.avatarItemId;
	if (patch.avatarCrop !== undefined) {
		set.avatarCrop = patch.avatarCrop === null ? null : JSON.stringify(patch.avatarCrop);
	}
	if (Object.keys(set).length > 0) await db.update(people).set(set).where(eq(people.id, id));
	if (set.name !== undefined) await reindexItemsForPerson(db, id);
}

export async function deletePersonGuarded(
	db: Db,
	id: string
): Promise<{ ok: true } | { ok: false; taggedCount: number }> {
	const row = (await db.select().from(people).where(eq(people.id, id)).limit(1))[0];
	if (!row) error(404, 'person not found');

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(itemPeople)
		.where(eq(itemPeople.personId, id));
	const taggedCount = Number(count);
	if (taggedCount > 0) return { ok: false, taggedCount };

	await db
		.delete(relationships)
		.where(or(eq(relationships.personA, id), eq(relationships.personB, id)));
	await db.update(users).set({ personId: null }).where(eq(users.personId, id));
	await db.delete(people).where(eq(people.id, id));
	// Removing this person's manual edges may orphan inferred edges elsewhere.
	await recomputeFamilyInference(db);
	return { ok: true };
}

export async function applyRelationshipChanges(
	db: Db,
	storage: StorageAdapter,
	personId: string,
	changes: { add: Rel[]; remove: Rel[] }
): Promise<FamilyRefs> {
	const row = (await db.select().from(people).where(eq(people.id, personId)).limit(1))[0];
	if (!row) error(404, 'person not found');

	const all = [...changes.add, ...changes.remove];
	for (const rel of all) {
		if (
			typeof rel?.personA !== 'string' ||
			typeof rel?.personB !== 'string' ||
			!REL_TYPES.includes(rel.type)
		) {
			error(400, 'malformed relationship');
		}
		if (rel.personA === rel.personB) error(400, 'a person cannot relate to themself');
		if (rel.personA !== personId && rel.personB !== personId) {
			error(400, 'relationship must involve this person');
		}
	}

	const personIds = [...new Set(all.flatMap((rel) => [rel.personA, rel.personB]))];
	if (personIds.length > 0) {
		const found = await db
			.select({ id: people.id })
			.from(people)
			.where(inArray(people.id, personIds));
		if (found.length !== personIds.length) error(400, 'unknown person id in relationship');
	}

	const adds = changes.add.map(canonicalRel);
	const removes = changes.remove.map(canonicalRel);
	// Only hand-set (manual) edges count as duplicates: an add that merely
	// matches an inferred edge is a legitimate promotion to manual.
	const existing = new Set(
		(await db.select().from(relationships)).filter((row) => row.source === 'manual').map(relKey)
	);
	for (const rel of removes) existing.delete(relKey(rel));
	const batch = new Set<string>();
	for (const rel of adds) {
		const key = relKey(rel);
		if (existing.has(key) || batch.has(key)) error(409, 'duplicate relationship');
		batch.add(key);
	}

	for (const rel of removes) {
		await db
			.delete(relationships)
			.where(
				and(
					eq(relationships.personA, rel.personA),
					eq(relationships.personB, rel.personB),
					eq(relationships.type, rel.type)
				)
			);
	}
	if (adds.length > 0) {
		// Drop any inferred edge the add duplicates so the unique index doesn't
		// reject the manual row, then insert the manual edge.
		for (const rel of adds) {
			await db
				.delete(relationships)
				.where(
					and(
						eq(relationships.personA, rel.personA),
						eq(relationships.personB, rel.personB),
						eq(relationships.type, rel.type)
					)
				);
		}
		await db
			.insert(relationships)
			.values(adds.map((rel) => ({ id: nanoid(12), ...rel, source: 'manual' as const })));
	}

	await recomputeFamilyInference(db);
	return resolveFamily(db, storage, personId);
}

/**
 * Rebuild the inferred relationship edges from the manual ones. Inferred edges
 * are fully derived, so we can drop and regenerate them wholesale on any change.
 */
export async function recomputeFamilyInference(db: Db): Promise<void> {
	await db.delete(relationships).where(eq(relationships.source, 'inferred'));
	const manual = (await db.select().from(relationships)).map((row): Rel => ({
		personA: row.personA,
		personB: row.personB,
		type: row.type
	}));
	const derived = inferRelationships(manual);
	if (derived.length > 0) {
		await db
			.insert(relationships)
			.values(derived.map((rel) => ({ id: nanoid(12), ...rel, source: 'inferred' as const })));
	}
}

const REL_TYPES: RelType[] = ['parent-of', 'spouse-of', 'sibling-of'];

function relKey(rel: Rel): string {
	return `${rel.personA}|${rel.personB}|${rel.type}`;
}

function validCrop(crop: CropRect): boolean {
	return (
		[crop.x, crop.y, crop.w, crop.h].every(
			(value) => Number.isFinite(value) && value >= 0 && value <= 1
		) &&
		crop.w > 0 &&
		crop.h > 0 &&
		crop.x + crop.w <= 1 &&
		crop.y + crop.h <= 1
	);
}

export function personSlugBase(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'person';
}

async function uniquePersonSlug(db: Db, name: string, ignoreId?: string): Promise<string> {
	const base = personSlugBase(name);
	const rows = await db.select({ id: people.id, slug: people.slug }).from(people);
	const used = new Set(rows.filter((row) => row.id !== ignoreId).map((row) => row.slug));
	if (!used.has(base)) return base;
	for (let n = 2; ; n += 1) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
}
