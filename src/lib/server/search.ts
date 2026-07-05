import { sql } from 'drizzle-orm';
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
		(await db.all(sql`SELECT item_id AS id FROM item_people WHERE person_id = ${personId}`)) as Array<{
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
		(await db.all(sql`SELECT item_id AS id FROM album_items WHERE album_id = ${albumId}`)) as Array<{
			id: string;
		}>
	);
}

export function ftsMatchExpr(text: string): string {
	const tokens: string[] = [];
	for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
		const raw = (match[1] ?? match[2] ?? '').trim();
		if (!/[\p{L}\p{N}]/u.test(raw)) continue;
		tokens.push(`"${raw.replace(/"/g, '""')}"`);
	}
	return tokens.join(' ');
}
