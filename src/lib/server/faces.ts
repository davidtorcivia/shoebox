import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '$lib/server/db';
import {
	faces,
	faceSuggestionDismissals,
	itemFiles,
	itemPeople,
	items,
	people
} from '$lib/server/db/schema';
import type { StorageAdapter } from '$lib/server/platform/types';
import { reindexItem } from '$lib/server/search';

export type FaceBox = { x: number; y: number; w: number; h: number };

export type FaceSuggestion = {
	clusterId: string;
	count: number;
	suggestedPerson: { id: string; name: string } | null;
	faces: Array<{
		id: string;
		itemId: string;
		itemType: 'photo' | 'video';
		frameTime: number | null;
		box: FaceBox;
		thumbUrl: string;
		cropUrl: string;
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
			storageKey: itemFiles.storageKey,
			suggestedPersonId: people.id,
			suggestedPersonName: people.name
		})
		.from(faces)
		.innerJoin(items, eq(items.id, faces.itemId))
		.leftJoin(itemFiles, and(eq(itemFiles.itemId, faces.itemId), eq(itemFiles.kind, 'thumb_400')))
		.leftJoin(people, eq(people.id, faces.suggestedPersonId))
		.where(and(eq(faces.status, 'pending'), isNotNull(faces.clusterId), isNull(items.deletedAt)));

	const clusters = new Map<string, FaceSuggestion>();
	for (const row of rows) {
		if (!row.clusterId) continue;
		const cluster = clusters.get(row.clusterId) ?? {
			clusterId: row.clusterId,
			count: 0,
			suggestedPerson: null,
			faces: []
		};
		if (row.suggestedPersonId && row.suggestedPersonName) {
			cluster.suggestedPerson = { id: row.suggestedPersonId, name: row.suggestedPersonName };
		}
		cluster.faces.push({
			id: row.id,
			itemId: row.itemId,
			itemType: row.itemType,
			frameTime: row.frameTime,
			box: parseBox(row.box),
			thumbUrl: row.storageKey ? await storage.mediaUrl(row.storageKey) : '',
			// Written by the faces worker at scan time; the UI falls back to the
			// boxed item thumbnail when a face predates crop generation.
			cropUrl: await storage.mediaUrl(`media/${row.itemId}/faces/${row.id}.jpg`)
		});
		cluster.count = cluster.faces.length;
		clusters.set(row.clusterId, cluster);
	}

	// Clusters with a person suggestion come first — those are one-click reviews.
	return [...clusters.values()].sort(
		(a, b) =>
			Number(!!b.suggestedPerson) - Number(!!a.suggestedPerson) ||
			b.count - a.count ||
			a.clusterId.localeCompare(b.clusterId)
	);
}

export type UnmatchedFace = {
	id: string;
	itemId: string;
	itemTitle: string | null;
	itemType: 'photo' | 'video';
	frameTime: number | null;
	box: FaceBox;
	thumbUrl: string;
	cropUrl: string;
};

/**
 * Pending faces the clusterer left as noise (no cluster id) — real detections
 * that would otherwise be invisible: a person glimpsed too briefly to form a
 * tracklet still deserves a face in review.
 */
export async function listUnmatched(
	db: Db,
	storage: StorageAdapter,
	limit = 120
): Promise<{ faces: UnmatchedFace[]; total: number }> {
	const rows = await db
		.select({
			id: faces.id,
			itemId: faces.itemId,
			itemTitle: items.title,
			itemType: items.type,
			frameTime: faces.frameTime,
			box: faces.box,
			storageKey: itemFiles.storageKey
		})
		.from(faces)
		.innerJoin(items, eq(items.id, faces.itemId))
		.leftJoin(itemFiles, and(eq(itemFiles.itemId, faces.itemId), eq(itemFiles.kind, 'thumb_400')))
		.where(and(eq(faces.status, 'pending'), isNull(faces.clusterId), isNull(items.deletedAt)))
		.orderBy(faces.itemId, faces.frameTime);

	const out: UnmatchedFace[] = [];
	for (const row of rows.slice(0, limit)) {
		out.push({
			id: row.id,
			itemId: row.itemId,
			itemTitle: row.itemTitle,
			itemType: row.itemType,
			frameTime: row.frameTime,
			box: parseBox(row.box),
			thumbUrl: row.storageKey ? await storage.mediaUrl(row.storageKey) : '',
			cropUrl: await storage.mediaUrl(`media/${row.itemId}/faces/${row.id}.jpg`)
		});
	}
	return { faces: out, total: rows.length };
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
		.set({ status: 'confirmed', personId, suggestedPersonId: null })
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
		.set({ status: 'rejected', clusterId: null, personId: null, suggestedPersonId: null })
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
		.set({ status: 'rejected', clusterId: null, personId: null, suggestedPersonId: null })
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
		.set({ clusterId: nextClusterId, status: 'pending', personId: null, suggestedPersonId: null })
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

export type SuggestedPerson = {
	person: { id: string; slug: string; name: string; accentColor: string };
	faceIds: string[];
	count: number;
};

/**
 * People the face worker thinks appear in this item but who are not yet tagged
 * on it — the item page renders these as one-click "add person" chips.
 */
export async function suggestedPeopleForItem(db: Db, itemId: string): Promise<SuggestedPerson[]> {
	const tagged = (
		await db
			.select({ personId: itemPeople.personId })
			.from(itemPeople)
			.where(eq(itemPeople.itemId, itemId))
	).map((row) => row.personId);

	const rows = await db
		.select({
			faceId: faces.id,
			personId: people.id,
			slug: people.slug,
			name: people.name,
			accentColor: people.accentColor
		})
		.from(faces)
		.innerJoin(people, eq(people.id, faces.suggestedPersonId))
		.where(
			and(
				eq(faces.itemId, itemId),
				eq(faces.status, 'pending'),
				tagged.length > 0 ? notInArray(faces.suggestedPersonId, tagged) : undefined
			)
		);

	const byPerson = new Map<string, SuggestedPerson>();
	for (const row of rows) {
		const entry = byPerson.get(row.personId) ?? {
			person: { id: row.personId, slug: row.slug, name: row.name, accentColor: row.accentColor },
			faceIds: [],
			count: 0
		};
		entry.faceIds.push(row.faceId);
		entry.count = entry.faceIds.length;
		byPerson.set(row.personId, entry);
	}
	return [...byPerson.values()].sort(
		(a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name)
	);
}

/** Confirm a suggested person on an item: their suggested faces become confirmed
 * and the person is tagged on the item (via assignFaces). */
export async function confirmSuggestedPerson(
	db: Db,
	itemId: string,
	personId: string,
	opts: WriteOptions = {}
): Promise<void> {
	const rows = await db
		.select({ id: faces.id })
		.from(faces)
		.where(
			and(
				eq(faces.itemId, itemId),
				eq(faces.status, 'pending'),
				eq(faces.suggestedPersonId, personId)
			)
		);
	if (rows.length === 0) error(404, 'no suggested faces for this person');
	await assignFaces(
		db,
		rows.map((row) => row.id),
		personId,
		opts
	);
	// A confirm supersedes any earlier "not them".
	await db
		.delete(faceSuggestionDismissals)
		.where(
			and(
				eq(faceSuggestionDismissals.itemId, itemId),
				eq(faceSuggestionDismissals.personId, personId)
			)
		);
}

/** "Not them": clear the suggestion on this item's faces and record the pair so
 * the worker's next recluster doesn't resurface it. The faces stay pending for
 * normal cluster review — they may well be somebody else. */
export async function dismissSuggestedPerson(
	db: Db,
	itemId: string,
	personId: string
): Promise<void> {
	await db.insert(faceSuggestionDismissals).values({ itemId, personId }).onConflictDoNothing();
	await db
		.update(faces)
		.set({ suggestedPersonId: null })
		.where(
			and(
				eq(faces.itemId, itemId),
				eq(faces.status, 'pending'),
				eq(faces.suggestedPersonId, personId)
			)
		);
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
