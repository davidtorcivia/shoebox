import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { nextAccent } from '$lib/domain/accents';
import { ageAt } from '$lib/domain/ages';
import type { CropRect, FamilyRefs, PersonDetailDTO, PersonListDTO, PersonRef } from '$lib/domain/people-dto';
import { familyOf, type Rel } from '$lib/domain/relationships';
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function listPeople(db: Db, storage: StorageAdapter): Promise<PersonListDTO[]> {
	const rows = await db
		.select({
			id: people.id,
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
		...(await db.select({ accentColor: users.accentColor }).from(users)).map((row) => row.accentColor),
		...(await db.select({ accentColor: people.accentColor }).from(people)).map(
			(row) => row.accentColor
		)
	];
	const id = nanoid(12);
	const accentColor = nextAccent(used);
	await db.insert(people).values({
		id,
		name,
		birthdate: input.birthdate ?? null,
		deathDate: input.deathDate ?? null,
		birthPlace: input.birthPlace ?? null,
		accentColor,
		createdAt: new Date()
	});

	return {
		id,
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

export async function resolveFamily(db: Db, personId: string): Promise<FamilyRefs> {
	const relRows = await db.select().from(relationships);
	const ids = familyOf(
		personId,
		relRows.map(
			(row): Rel => ({ personA: row.personA, personB: row.personB, type: row.type })
		)
	);
	const all = [...new Set(Object.values(ids).flat())];
	const refs = new Map<string, PersonRef>();
	if (all.length > 0) {
		const rows = await db
			.select({ id: people.id, name: people.name, accentColor: people.accentColor })
			.from(people)
			.where(inArray(people.id, all));
		for (const row of rows) refs.set(row.id, row);
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

	const liveTagged = and(eq(itemPeople.personId, id), isNull(items.deletedAt), eq(items.status, 'ready'));
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
		family: await resolveFamily(db, id),
		years,
		stats: {
			moments: momentCount,
			onFilm: years.length ? { from: years[0].year, to: years[years.length - 1].year } : null,
			albums: Number(albumCount)
		},
		linkedUsername: linked?.username ?? null
	};
}

function parseCrop(raw: string | null): CropRect | null {
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
