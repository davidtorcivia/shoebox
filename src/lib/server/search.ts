import { sql, type SQL } from 'drizzle-orm';
import { dateWindowForAge } from '../domain/ages';
import type { SearchQuery } from '../domain/search-query';
import type { Db } from './db';

type Row = Record<string, unknown>;

const joinColumn = (rows: Row[], column: string) =>
	rows.map((row) => String(row[column] ?? '')).join(' ');

export async function reindexItem(db: Db, itemId: string): Promise<void> {
	const rows = (await db.all(
		sql`SELECT rowid AS rowid, title, description, deleted_at AS deletedAt FROM items WHERE id = ${itemId}`
	)) as Array<{
		rowid: number;
		title: string | null;
		description: string | null;
		deletedAt: number | null;
	}>;
	const item = rows[0];
	if (!item) return;

	await db.run(sql`DELETE FROM search_fts WHERE rowid = ${item.rowid}`);
	if (item.deletedAt != null) return;

	const people = (await db.all(
		sql`SELECT (p.name || CASE WHEN p.nickname IS NOT NULL THEN ' ' || p.nickname ELSE '' END) AS value
		    FROM item_people ip
		    INNER JOIN people p ON p.id = ip.person_id
		    WHERE ip.item_id = ${itemId}`
	)) as Row[];
	const tags = (await db.all(
		sql`SELECT t.name AS value
		    FROM item_tags it
		    INNER JOIN tags t ON t.id = it.tag_id
		    WHERE it.item_id = ${itemId}`
	)) as Row[];
	const albums = (await db.all(
		sql`SELECT a.title AS value
		    FROM album_items ai
		    INNER JOIN albums a ON a.id = ai.album_id
		    WHERE ai.item_id = ${itemId} AND a.deleted_at IS NULL`
	)) as Row[];
	const comments = (await db.all(
		sql`SELECT c.body AS value
		    FROM comments c
		    WHERE c.item_id = ${itemId} AND c.deleted_at IS NULL`
	)) as Row[];

	await db.run(
		sql`INSERT INTO search_fts (rowid, item_id, title, description, people, tags, albums, comments)
		    VALUES (
			    ${item.rowid},
			    ${itemId},
			    ${item.title ?? ''},
			    ${item.description ?? ''},
			    ${joinColumn(people, 'value')},
			    ${joinColumn(tags, 'value')},
			    ${joinColumn(albums, 'value')},
			    ${joinColumn(comments, 'value')}
		    )`
	);
}

export async function reindexAll(db: Db): Promise<number> {
	await db.run(sql`INSERT INTO search_fts(search_fts) VALUES ('delete-all')`);
	const rows = (await db.all(sql`SELECT id FROM items WHERE deleted_at IS NULL`)) as Array<{
		id: string;
	}>;
	for (const row of rows) await reindexItem(db, row.id);
	return rows.length;
}

async function reindexIds(db: Db, rows: Array<{ id: string }>): Promise<void> {
	for (const row of rows) await reindexItem(db, row.id);
}

export async function reindexItemsForPerson(db: Db, personId: string): Promise<void> {
	await reindexIds(
		db,
		(await db.all(
			sql`SELECT item_id AS id FROM item_people WHERE person_id = ${personId}`
		)) as Array<{
			id: string;
		}>
	);
}

export async function reindexItemsForTag(db: Db, tagId: string): Promise<void> {
	await reindexIds(
		db,
		(await db.all(sql`SELECT item_id AS id FROM item_tags WHERE tag_id = ${tagId}`)) as Array<{
			id: string;
		}>
	);
}

export async function reindexItemsForAlbum(db: Db, albumId: string): Promise<void> {
	await reindexIds(
		db,
		(await db.all(
			sql`SELECT item_id AS id FROM album_items WHERE album_id = ${albumId}`
		)) as Array<{
			id: string;
		}>
	);
}

export function ftsMatchExpr(text: string): string {
	const tokens: string[] = [];
	for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
		const quoted = match[1] !== undefined;
		const raw = (match[1] ?? match[2] ?? '').trim();
		if (!/[\p{L}\p{N}]/u.test(raw)) continue;
		const phrase = `"${raw.replace(/"/g, '""')}"`;
		// Bareword tokens become FTS prefix queries so partially-typed terms match
		// as you type ("chris" -> Christmas, "beac" -> beach). Explicitly quoted
		// phrases stay exact so a user can still pin down a precise match.
		tokens.push(quoted ? phrase : `${phrase}*`);
	}
	return tokens.join(' ');
}

export interface ItemFilter {
	text?: string;
	personIds?: string[];
	personNames?: string[];
	tagIds?: string[];
	tagNames?: string[];
	type?: 'video' | 'photo';
	albumId?: string;
	albumTitle?: string;
	uploaderUsername?: string;
	yearFrom?: number;
	yearTo?: number;
	age?: { personName: string; min: number; max: number };
}

export function filterFromQuery(q: SearchQuery): ItemFilter {
	return {
		text: q.text || undefined,
		personNames: q.people.length ? q.people : undefined,
		tagNames: q.tags.length ? q.tags : undefined,
		type: q.type,
		albumTitle: q.album,
		uploaderUsername: q.uploader,
		yearFrom: q.yearFrom,
		yearTo: q.yearTo,
		age: q.age ? { personName: q.age.person, min: q.age.min, max: q.age.max } : undefined
	};
}

export interface BuiltConditions {
	conds: SQL[];
	warnings: string[];
	impossible: boolean;
}

export async function buildItemConditions(db: Db, f: ItemFilter): Promise<BuiltConditions> {
	const conds: SQL[] = [sql`i.deleted_at IS NULL`, sql`i.status = 'ready'`];
	const warnings: string[] = [];
	const impossible = (warning: string): BuiltConditions => ({
		conds,
		warnings: [...warnings, warning],
		impossible: true
	});

	if (f.type) conds.push(sql`i.type = ${f.type}`);

	if (f.text) {
		const match = ftsMatchExpr(f.text);
		if (match)
			conds.push(sql`i.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ${match})`);
	}

	const resolvedPeople: Array<{ id: string; name: string; birthdate: string | null }> = [];
	for (const name of f.personNames ?? []) {
		const rows = (await db.all(
			sql`SELECT id, name, birthdate FROM people WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`
		)) as Array<{ id: string; name: string; birthdate: string | null }>;
		if (!rows[0]) return impossible(`No person named "${name}"`);
		resolvedPeople.push(rows[0]);
		conds.push(sql`i.id IN (SELECT item_id FROM item_people WHERE person_id = ${rows[0].id})`);
	}

	for (const personId of f.personIds ?? []) {
		conds.push(sql`i.id IN (SELECT item_id FROM item_people WHERE person_id = ${personId})`);
	}

	for (const name of f.tagNames ?? []) {
		const rows = (await db.all(
			sql`SELECT id FROM tags WHERE name = ${name.toLowerCase()} LIMIT 1`
		)) as Array<{ id: string }>;
		if (!rows[0]) return impossible(`No tag "${name}"`);
		conds.push(sql`i.id IN (SELECT item_id FROM item_tags WHERE tag_id = ${rows[0].id})`);
	}

	for (const tagId of f.tagIds ?? []) {
		conds.push(sql`i.id IN (SELECT item_id FROM item_tags WHERE tag_id = ${tagId})`);
	}

	if (f.albumTitle) {
		const rows = (await db.all(
			sql`SELECT id FROM albums
			    WHERE lower(title) = ${f.albumTitle.toLowerCase()} AND deleted_at IS NULL
			    LIMIT 1`
		)) as Array<{ id: string }>;
		if (!rows[0]) return impossible(`No album titled "${f.albumTitle}"`);
		conds.push(sql`i.id IN (SELECT item_id FROM album_items WHERE album_id = ${rows[0].id})`);
	}

	if (f.albumId) {
		conds.push(sql`i.id IN (SELECT item_id FROM album_items WHERE album_id = ${f.albumId})`);
	}

	if (f.uploaderUsername) {
		const rows = (await db.all(
			sql`SELECT id FROM users WHERE lower(username) = ${f.uploaderUsername.toLowerCase()} LIMIT 1`
		)) as Array<{ id: string }>;
		if (!rows[0]) return impossible(`No uploader "${f.uploaderUsername}"`);
		conds.push(sql`i.uploaded_by = ${rows[0].id}`);
	}

	if (f.yearFrom != null) {
		const to = f.yearTo ?? f.yearFrom;
		conds.push(
			sql`i.sort_date IS NOT NULL
			    AND i.sort_date >= ${`${f.yearFrom}-01-01`}
			    AND i.sort_date <= ${`${to}-12-31`}`
		);
	}

	if (f.age) {
		const person = resolvedPeople.find(
			(row) => row.name.toLowerCase() === f.age!.personName.toLowerCase()
		);
		if (!person) {
			warnings.push(`Ignored age filter - person:"${f.age.personName}" is not part of this query`);
		} else if (!person.birthdate) {
			warnings.push(`Ignored age filter - ${person.name} has no birthdate`);
		} else {
			const window = dateWindowForAge(person.birthdate, { min: f.age.min, max: f.age.max });
			conds.push(
				sql`i.date_start IS NOT NULL
				    AND i.date_end IS NOT NULL
				    AND i.date_start <= ${window.end}
				    AND i.date_end >= ${window.start}`
			);
		}
	}

	return { conds, warnings, impossible: false };
}

export interface SearchExecResult {
	itemIds: string[];
	nextCursor: string | null;
	warnings: string[];
}

export async function executeSearch(
	db: Db,
	q: SearchQuery & { warnings?: string[] },
	opts: { cursor?: string; limit?: number } = {}
): Promise<SearchExecResult> {
	const limit = Math.max(1, Math.min(opts.limit ?? 48, 100));
	const built = await buildItemConditions(db, filterFromQuery(q));
	const warnings = [...(q.warnings ?? []), ...built.warnings];
	if (built.impossible) return { itemIds: [], nextCursor: null, warnings };

	const conds = [...built.conds];
	if (opts.cursor) {
		const sep = opts.cursor.lastIndexOf('~');
		const cursorSortDate = sep >= 0 ? opts.cursor.slice(0, sep) : '';
		const cursorId = sep >= 0 ? opts.cursor.slice(sep + 1) : opts.cursor;
		conds.push(
			sql`(
				coalesce(i.sort_date, '') < ${cursorSortDate}
				OR (coalesce(i.sort_date, '') = ${cursorSortDate} AND i.id < ${cursorId})
			)`
		);
	}

	const where = sql.join(conds, sql` AND `);
	const rows = (await db.all(
		sql`SELECT i.id AS id, coalesce(i.sort_date, '') AS sortDate
		    FROM items i
		    WHERE ${where}
		    ORDER BY coalesce(i.sort_date, '') DESC, i.id DESC
		    LIMIT ${limit + 1}`
	)) as Array<{ id: string; sortDate: string }>;

	const page = rows.slice(0, limit);
	const last = page.at(-1);
	const nextCursor = rows.length > limit && last ? `${last.sortDate}~${last.id}` : null;
	return { itemIds: page.map((row) => row.id), nextCursor, warnings };
}

export interface PersonCard {
	id: string;
	slug: string;
	name: string;
	accentColor: string;
	avatarItemId: string | null;
	avatarCrop: string | null;
	avatarStorageKey: string | null;
	avatarType: string | null;
	avatarPosterTime: number | null;
}

export interface AlbumCard {
	id: string;
	title: string;
	coverItemId: string | null;
	coverStorageKey: string | null;
	itemCount: number;
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

function textTokens(text: string): string[] {
	return text.replace(/"/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

export async function searchPeopleCards(db: Db, text: string, limit = 8): Promise<PersonCard[]> {
	const tokens = textTokens(text);
	if (tokens.length === 0) return [];
	const likes = tokens.map((token) => sql`p.name LIKE ${`%${likeEscape(token)}%`} ESCAPE ${'\\'}`);
	return (await db.all(
		sql`SELECT p.id AS id,
		           p.slug AS slug,
		           p.name AS name,
		           p.accent_color AS accentColor,
		           p.avatar_item_id AS avatarItemId,
		           p.avatar_crop AS avatarCrop,
		           f.storage_key AS avatarStorageKey,
		           i.type AS avatarType,
		           i.poster_time AS avatarPosterTime
		    FROM people p
		    LEFT JOIN item_files f ON f.item_id = p.avatar_item_id AND f.kind = 'thumb_400'
		    LEFT JOIN items i ON i.id = p.avatar_item_id
		    WHERE ${sql.join(likes, sql` OR `)}
		    ORDER BY p.name
		    LIMIT ${limit}`
	)) as PersonCard[];
}

export async function searchAlbumCards(db: Db, text: string, limit = 8): Promise<AlbumCard[]> {
	const tokens = textTokens(text);
	if (tokens.length === 0) return [];
	const likes = tokens.map((token) => sql`a.title LIKE ${`%${likeEscape(token)}%`} ESCAPE ${'\\'}`);
	return (await db.all(
		sql`SELECT a.id AS id,
		           a.title AS title,
		           a.cover_item_id AS coverItemId,
		           f.storage_key AS coverStorageKey,
		           (SELECT count(*) FROM album_items ai WHERE ai.album_id = a.id) AS itemCount
		    FROM albums a
		    LEFT JOIN item_files f ON f.item_id = a.cover_item_id AND f.kind = 'thumb_400'
		    WHERE a.deleted_at IS NULL AND (${sql.join(likes, sql` OR `)})
		    ORDER BY a.title
		    LIMIT ${limit}`
	)) as AlbumCard[];
}

export async function filteredYearCounts(
	db: Db,
	f: ItemFilter
): Promise<{ year: number; count: number }[]> {
	const built = await buildItemConditions(db, f);
	if (built.impossible) return [];
	const where = sql.join(built.conds, sql` AND `);
	return (await db.all(
		sql`SELECT CAST(substr(i.sort_date, 1, 4) AS INTEGER) AS year,
		           COUNT(*) AS count
		    FROM items i
		    WHERE ${where} AND i.sort_date IS NOT NULL AND CAST(substr(i.sort_date, 1, 4) AS INTEGER) >= 1
		    GROUP BY year
		    ORDER BY year`
	)) as { year: number; count: number }[];
}
