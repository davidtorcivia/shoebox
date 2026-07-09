import { sql } from 'drizzle-orm';
import type { CropRect } from '$lib/domain/people-dto';
import type { Db } from './db';
import { parseCrop } from './people';
import type { StorageAdapter } from './platform/types';

export interface TagRef {
	id: string;
	name: string;
	kind: 'topic' | 'holiday';
}

export interface TagPerson {
	id: string;
	slug: string;
	name: string;
	accentColor: string;
	avatarUrl: string | null;
	avatarCrop: CropRect | null;
	count: number;
}

export interface TagOverview extends TagRef {
	count: number;
	photoCount: number;
	videoCount: number;
	yearFrom: number | null;
	yearTo: number | null;
	coverUrl: string | null;
	people: TagPerson[];
}

export async function getTagByName(db: Db, name: string): Promise<TagRef | null> {
	const rows = (await db.all(
		sql`SELECT id, name, kind FROM tags WHERE name = ${name.toLowerCase()} LIMIT 1`
	)) as TagRef[];
	return rows[0] ?? null;
}

export async function getTagOverview(
	db: Db,
	storage: StorageAdapter,
	tag: TagRef
): Promise<TagOverview> {
	const typeRows = (await db.all(
		sql`SELECT i.type AS type, COUNT(*) AS c
		    FROM items i
		    INNER JOIN item_tags it ON it.item_id = i.id
		    WHERE it.tag_id = ${tag.id} AND i.deleted_at IS NULL AND i.status = 'ready'
		    GROUP BY i.type`
	)) as Array<{ type: 'photo' | 'video'; c: number }>;
	let photoCount = 0;
	let videoCount = 0;
	for (const row of typeRows) {
		if (row.type === 'video') videoCount = Number(row.c);
		else photoCount = Number(row.c);
	}

	const spanRows = (await db.all(
		sql`SELECT MIN(substr(i.sort_date, 1, 4)) AS lo, MAX(substr(i.sort_date, 1, 4)) AS hi
		    FROM items i
		    INNER JOIN item_tags it ON it.item_id = i.id
		    WHERE it.tag_id = ${tag.id}
		      AND i.deleted_at IS NULL AND i.status = 'ready' AND i.sort_date IS NOT NULL`
	)) as Array<{ lo: string | null; hi: string | null }>;
	const yearFrom = spanRows[0]?.lo ? Number(spanRows[0].lo) : null;
	const yearTo = spanRows[0]?.hi ? Number(spanRows[0].hi) : null;

	// Cover: the most recent tagged moment's mid-size thumbnail.
	const coverRows = (await db.all(
		sql`SELECT f.storage_key AS key, i.type AS type, i.poster_time AS posterTime
		    FROM items i
		    INNER JOIN item_tags it ON it.item_id = i.id
		    LEFT JOIN item_files f ON f.item_id = i.id AND f.kind = 'thumb_800'
		    WHERE it.tag_id = ${tag.id} AND i.deleted_at IS NULL AND i.status = 'ready'
		    ORDER BY coalesce(i.sort_date, '') DESC, i.id DESC
		    LIMIT 1`
	)) as Array<{ key: string | null; type: 'photo' | 'video'; posterTime: number | null }>;
	const cover = coverRows[0];
	const coverBust =
		cover?.type === 'video' && cover.posterTime != null ? `?v=${cover.posterTime}` : '';
	const coverUrl = cover?.key ? (await storage.mediaUrl(cover.key)) + coverBust : null;

	const peopleRows = (await db.all(
		sql`SELECT p.id AS id,
		           p.slug AS slug,
		           p.name AS name,
		           p.accent_color AS accentColor,
		           p.avatar_item_id AS avatarItemId,
		           p.avatar_crop AS avatarCrop,
		           af.storage_key AS avatarStorageKey,
		           ai.type AS avatarType,
		           ai.poster_time AS avatarPosterTime,
		           COUNT(*) AS c
		    FROM item_people ip
		    INNER JOIN items i ON i.id = ip.item_id AND i.deleted_at IS NULL AND i.status = 'ready'
		    INNER JOIN item_tags it ON it.item_id = ip.item_id
		    INNER JOIN people p ON p.id = ip.person_id
		    LEFT JOIN item_files af ON af.item_id = p.avatar_item_id AND af.kind = 'thumb_400'
		    LEFT JOIN items ai ON ai.id = p.avatar_item_id
		    WHERE it.tag_id = ${tag.id}
		    GROUP BY p.id
		    ORDER BY c DESC, p.name
		    LIMIT 12`
	)) as Array<{
		id: string;
		slug: string;
		name: string;
		accentColor: string;
		avatarCrop: string | null;
		avatarStorageKey: string | null;
		avatarType: string | null;
		avatarPosterTime: number | null;
		c: number;
	}>;

	const people: TagPerson[] = await Promise.all(
		peopleRows.map(async (row) => {
			const bust =
				row.avatarType === 'video' && row.avatarPosterTime != null
					? `?v=${row.avatarPosterTime}`
					: '';
			const crop = parseCrop(row.avatarCrop);
			const url = row.avatarStorageKey
				? (await storage.mediaUrl(row.avatarStorageKey)) + bust
				: null;
			return {
				id: row.id,
				slug: row.slug,
				name: row.name,
				accentColor: row.accentColor,
				avatarUrl: url && crop ? url : null,
				avatarCrop: url && crop ? crop : null,
				count: Number(row.c)
			};
		})
	);

	return {
		...tag,
		count: photoCount + videoCount,
		photoCount,
		videoCount,
		yearFrom,
		yearTo,
		coverUrl,
		people
	};
}
