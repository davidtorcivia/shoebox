import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '$lib/server/db';
import { faces, itemFiles, itemPeople, items, people } from '$lib/server/db/schema';
import type { StorageAdapter } from '$lib/server/platform/types';

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
	person: { id: string; name: string; accentColor: string };
};

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

export async function assignCluster(db: Db, clusterId: string, personId: string): Promise<void> {
	const person = (
		await db.select({ id: people.id }).from(people).where(eq(people.id, personId)).limit(1)
	)[0];
	if (!person) error(404, 'person not found');

	const rows = await db.select().from(faces).where(eq(faces.clusterId, clusterId));
	if (rows.length === 0) error(404, 'cluster not found');

	await db
		.update(faces)
		.set({ status: 'confirmed', personId })
		.where(eq(faces.clusterId, clusterId));
	for (const face of rows) {
		await db
			.insert(itemPeople)
			.values({ itemId: face.itemId, personId, faceBox: face.box, source: 'ml' })
			.onConflictDoUpdate({
				target: [itemPeople.itemId, itemPeople.personId],
				set: { faceBox: face.box, source: 'ml' }
			});
	}
}

export async function rejectCluster(db: Db, clusterId: string): Promise<void> {
	await db
		.update(faces)
		.set({ status: 'rejected', clusterId: null, personId: null })
		.where(eq(faces.clusterId, clusterId));
}

export async function splitCluster(
	db: Db,
	clusterId: string,
	faceIds: string[],
	makeId = () => nanoid(12)
): Promise<string> {
	const ids = [...new Set(faceIds)];
	if (ids.length === 0) error(400, 'faceIds required');
	const nextClusterId = makeId();
	await db
		.update(faces)
		.set({ clusterId: nextClusterId, status: 'pending', personId: null })
		.where(and(eq(faces.clusterId, clusterId), inArray(faces.id, ids)));
	return nextClusterId;
}

export async function updateFaceBox(db: Db, faceId: string, box: FaceBox): Promise<void> {
	if (!validBox(box)) error(400, 'invalid face box');
	await db
		.update(faces)
		.set({ box: boxJson(box) })
		.where(eq(faces.id, faceId));
}

export async function confirmedFacesForItem(db: Db, itemId: string): Promise<ConfirmedFace[]> {
	const rows = await db
		.select({
			id: faces.id,
			box: faces.box,
			frameTime: faces.frameTime,
			personId: people.id,
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
		person: { id: row.personId, name: row.name, accentColor: row.accentColor }
	}));
}
