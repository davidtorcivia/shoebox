import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '$lib/server/db';
import { faces, itemFiles, itemPeople, items, people } from '$lib/server/db/schema';
import type { StorageAdapter } from '$lib/server/platform/types';
import { reindexItem } from '$lib/server/search';

export type FaceBox = { x: number; y: number; w: number; h: number };

export type FaceSuggestion = {
	clusterId: string;
	count: number;
	faces: Array<{
		id: string;
		itemId: string;
		itemType: 'photo' | 'video';
		frameTime: number | null;
		box: FaceBox;
		thumbUrl: string;
	}>;
};

export type ConfirmedFace = {
	id: string;
	box: FaceBox;
	frameTime: number | null;
	person: { id: string; slug: string; name: string; accentColor: string };
};

type ReindexFn = (db: Db, itemId: string) => Promise<void>;
type WriteOptions = { reindex?: ReindexFn };

function parseBox(raw: string): FaceBox {
	const box = JSON.parse(raw) as Partial<FaceBox>;
	if (!validBox(box)) error(500, 'invalid stored face box');
	return { x: box.x, y: box.y, w: box.w, h: box.h };
}

function validBox(box: Partial<FaceBox>): box is FaceBox {
	return (
		typeof box.x === 'number' &&
		typeof box.y === 'number' &&
		typeof box.w === 'number' &&
		typeof box.h === 'number' &&
		box.x >= 0 &&
		box.y >= 0 &&
		box.w > 0 &&
		box.h > 0 &&
		box.x + box.w <= 1 &&
		box.y + box.h <= 1
	);
}

function boxJson(box: FaceBox): string {
	return JSON.stringify({ x: box.x, y: box.y, w: box.w, h: box.h });
}

async function assertItemsExist(db: Db, itemIds: string[]): Promise<void> {
	const ids = [...new Set(itemIds)];
	if (ids.length === 0) return;
	const found = await db
		.select({ id: items.id })
		.from(items)
		.where(and(inArray(items.id, ids), isNull(items.deletedAt)));
	if (found.length !== ids.length) error(404, 'item not found');
}

async function reindexAffected(db: Db, itemIds: string[], reindex: ReindexFn): Promise<void> {
	for (const itemId of [...new Set(itemIds)]) await reindex(db, itemId);
}

export async function listSuggestions(db: Db, storage: StorageAdapter): Promise<FaceSuggestion[]> {
	const rows = await db
		.select({
			id: faces.id,
			clusterId: faces.clusterId,
			itemId: faces.itemId,
			itemType: items.type,
			frameTime: faces.frameTime,
			box: faces.box,
			storageKey: itemFiles.storageKey
		})
		.from(faces)
		.innerJoin(items, eq(items.id, faces.itemId))
		.leftJoin(itemFiles, and(eq(itemFiles.itemId, faces.itemId), eq(itemFiles.kind, 'thumb_400')))
		.where(and(eq(faces.status, 'pending'), isNotNull(faces.clusterId), isNull(items.deletedAt)));

	const clusters = new Map<string, FaceSuggestion>();
	for (const row of rows) {
		if (!row.clusterId) continue;
		const cluster = clusters.get(row.clusterId) ?? {
			clusterId: row.clusterId,
			count: 0,
			faces: []
		};
		cluster.faces.push({
			id: row.id,
			itemId: row.itemId,
			itemType: row.itemType,
			frameTime: row.frameTime,
			box: parseBox(row.box),
			thumbUrl: row.storageKey ? await storage.mediaUrl(row.storageKey) : ''
		});
		cluster.count = cluster.faces.length;
		clusters.set(row.clusterId, cluster);
	}

	return [...clusters.values()].sort(
		(a, b) => b.count - a.count || a.clusterId.localeCompare(b.clusterId)
	);
}

// Cluster members whose item is still live. Suggestions only surface clusters
// by their live-item faces, so assign/reject must act on exactly that set — a
// stray face on a soft-deleted item must not block the whole cluster.
async function liveClusterFaces(
	db: Db,
	clusterId: string
): Promise<Array<{ id: string; itemId: string; box: string }>> {
	return db
		.select({ id: faces.id, itemId: faces.itemId, box: faces.box })
		.from(faces)
		.innerJoin(items, eq(items.id, faces.itemId))
		.where(and(eq(faces.clusterId, clusterId), isNull(items.deletedAt)));
}

// Live faces (item not soft-deleted) among the given ids.
async function liveFacesByIds(
	db: Db,
	faceIds: string[]
): Promise<Array<{ id: string; itemId: string; box: string }>> {
	const ids = [...new Set(faceIds)];
	if (ids.length === 0) return [];
	return db
		.select({ id: faces.id, itemId: faces.itemId, box: faces.box })
		.from(faces)
		.innerJoin(items, eq(items.id, faces.itemId))
		.where(and(inArray(faces.id, ids), isNull(items.deletedAt)));
}

// Confirm a set of faces as a person. Operating on stable face ids (not the
// cluster id) makes this immune to the worker reclustering — and renaming
// cluster ids — between when the admin loads suggestions and clicks Assign.
export async function assignFaces(
	db: Db,
	faceIds: string[],
	personId: string,
	opts: WriteOptions = {}
): Promise<void> {
	const reindex = opts.reindex ?? reindexItem;
	const person = (
		await db.select({ id: people.id }).from(people).where(eq(people.id, personId)).limit(1)
	)[0];
	if (!person) error(404, 'person not found');

	const rows = await liveFacesByIds(db, faceIds);
	if (rows.length === 0) error(404, 'no faces to assign');

	await db
		.update(faces)
		.set({ status: 'confirmed', personId })
		.where(
			inArray(
				faces.id,
				rows.map((row) => row.id)
			)
		);
	for (const face of rows) {
		await db
			.insert(itemPeople)
			.values({ itemId: face.itemId, personId, faceBox: face.box, source: 'ml' })
			.onConflictDoUpdate({
				target: [itemPeople.itemId, itemPeople.personId],
				set: { faceBox: face.box, source: 'ml' }
			});
	}
	await reindexAffected(
		db,
		rows.map((row) => row.itemId),
		reindex
	);
}

export async function rejectFaces(
	db: Db,
	faceIds: string[],
	opts: WriteOptions = {}
): Promise<void> {
	const reindex = opts.reindex ?? reindexItem;
	const rows = await liveFacesByIds(db, faceIds);
	if (rows.length === 0) error(404, 'no faces to reject');
	await db
		.update(faces)
		.set({ status: 'rejected', clusterId: null, personId: null })
		.where(
			inArray(
				faces.id,
				rows.map((row) => row.id)
			)
		);
	await reindexAffected(
		db,
		rows.map((row) => row.itemId),
		reindex
	);
}

export async function assignCluster(
	db: Db,
	clusterId: string,
	personId: string,
	opts: WriteOptions = {}
): Promise<void> {
	const rows = await liveClusterFaces(db, clusterId);
	if (rows.length === 0) error(404, 'cluster not found');
	await assignFaces(
		db,
		rows.map((row) => row.id),
		personId,
		opts
	);
}

export async function rejectCluster(
	db: Db,
	clusterId: string,
	opts: WriteOptions = {}
): Promise<void> {
	const rows = await liveClusterFaces(db, clusterId);
	if (rows.length === 0) error(404, 'cluster not found');
	await rejectFaces(
		db,
		rows.map((row) => row.id),
		opts
	);
}

// Reject a single bad face box, removing it from its cluster without touching
// the rest of the group.
export async function rejectFace(db: Db, faceId: string, opts: WriteOptions = {}): Promise<void> {
	const reindex = opts.reindex ?? reindexItem;
	const face = (await db.select().from(faces).where(eq(faces.id, faceId)).limit(1))[0];
	if (!face) error(404, 'face not found');
	await db
		.update(faces)
		.set({ status: 'rejected', clusterId: null, personId: null })
		.where(eq(faces.id, faceId));
	await reindex(db, face.itemId);
}

// Move the given faces into a fresh pending cluster. Keyed on stable face ids
// (not the source cluster id) so it survives a background recluster the same way
// assign/reject do.
export async function splitCluster(
	db: Db,
	faceIds: string[],
	makeId = () => nanoid(12),
	opts: WriteOptions = {}
): Promise<string> {
	const reindex = opts.reindex ?? reindexItem;
	const ids = [...new Set(faceIds)];
	if (ids.length === 0) error(400, 'faceIds required');
	const rows = await db.select().from(faces).where(inArray(faces.id, ids));
	if (rows.length !== ids.length) error(404, 'face not found');
	await assertItemsExist(
		db,
		rows.map((row) => row.itemId)
	);
	const nextClusterId = makeId();
	await db
		.update(faces)
		.set({ clusterId: nextClusterId, status: 'pending', personId: null })
		.where(inArray(faces.id, ids));
	await reindexAffected(
		db,
		rows.map((row) => row.itemId),
		reindex
	);
	return nextClusterId;
}

export async function updateFaceBox(
	db: Db,
	faceId: string,
	box: FaceBox,
	opts: WriteOptions = {}
): Promise<void> {
	if (!validBox(box)) error(400, 'invalid face box');
	const face = (await db.select().from(faces).where(eq(faces.id, faceId)).limit(1))[0];
	if (!face) error(404, 'face not found');
	await assertItemsExist(db, [face.itemId]);
	await db
		.update(faces)
		.set({ box: boxJson(box) })
		.where(eq(faces.id, faceId));
	await (opts.reindex ?? reindexItem)(db, face.itemId);
}

export async function confirmedFacesForItem(db: Db, itemId: string): Promise<ConfirmedFace[]> {
	const rows = await db
		.select({
			id: faces.id,
			box: faces.box,
			frameTime: faces.frameTime,
			personId: people.id,
			slug: people.slug,
			name: people.name,
			accentColor: people.accentColor
		})
		.from(faces)
		.innerJoin(people, eq(people.id, faces.personId))
		.where(and(eq(faces.itemId, itemId), eq(faces.status, 'confirmed')));

	return rows.map((row) => ({
		id: row.id,
		box: parseBox(row.box),
		frameTime: row.frameTime,
		person: { id: row.personId, slug: row.slug, name: row.name, accentColor: row.accentColor }
	}));
}
