/**
 * "Replace media" for arrivals: when a re-ingested file (say, a re-rendered
 * scan fixing a bad audio mix) shares its filename with an item already in the
 * library, the queue offers to swap the existing item's media in place —
 * keeping every bit of curation (title, date, people, tags, capture time,
 * poster choice) — and discard the fresh arrival instead of cataloging it twice.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { itemFiles, items } from '$lib/server/db/schema';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import { reindexItem } from '$lib/server/search';
import { hardDeleteItems } from '$lib/server/trash';
import { titleFromFilename } from '../../worker/conventions';

export type ReplaceCandidate = {
	id: string;
	title: string | null;
	sortDate: string | null;
	thumbUrl: string;
};

/**
 * For each queued arrival, the ready library item it most plausibly re-renders:
 * same ingest filename, or — for items ingested before filenames were recorded —
 * a title equal to the filename-derived title. Oldest match wins (the earliest
 * cataloged item is the curated one).
 */
export async function replaceCandidatesFor(
	db: Db,
	storage: StorageAdapter,
	arrivals: Array<{ id: string; type: 'video' | 'photo'; ingestName: string | null }>
): Promise<Record<string, ReplaceCandidate>> {
	const out: Record<string, ReplaceCandidate> = {};
	for (const arrival of arrivals) {
		if (!arrival.ingestName) continue;
		const derivedTitle = titleFromFilename(arrival.ingestName);
		const match = (
			await db
				.select({
					id: items.id,
					title: items.title,
					sortDate: items.sortDate,
					thumbKey: itemFiles.storageKey
				})
				.from(items)
				.leftJoin(itemFiles, and(eq(itemFiles.itemId, items.id), eq(itemFiles.kind, 'thumb_400')))
				.where(
					and(
						isNull(items.deletedAt),
						eq(items.status, 'ready'),
						eq(items.type, arrival.type),
						or(
							eq(items.ingestName, arrival.ingestName),
							// Legacy fallback only when a non-empty title can be derived —
							// otherwise this branch would match every pre-column item.
							derivedTitle
								? and(isNull(items.ingestName), eq(items.title, derivedTitle))
								: undefined
						)
					)
				)
				.orderBy(items.createdAt)
				.limit(1)
		)[0];
		if (match && match.id !== arrival.id) {
			out[arrival.id] = {
				id: match.id,
				title: match.title,
				sortDate: match.sortDate,
				thumbUrl: match.thumbKey ? await storage.mediaUrl(match.thumbKey) : ''
			};
		}
	}
	return out;
}

/**
 * Swap `targetId`'s original media for the arrival's file, keep all of the
 * target's curation, requeue every derivative, and purge the arrival item.
 */
export async function replaceItemMedia(
	db: Db,
	storage: StorageAdapter,
	queue: JobQueueAdapter,
	targetId: string,
	arrivalId: string,
	opts: { faces?: boolean } = {}
): Promise<void> {
	if (targetId === arrivalId) error(400, 'cannot replace an item with itself');
	const rows = await db
		.select()
		.from(items)
		.where(and(inArray(items.id, [targetId, arrivalId]), isNull(items.deletedAt)));
	const target = rows.find((row) => row.id === targetId);
	const arrival = rows.find((row) => row.id === arrivalId);
	if (!target || !arrival) error(404, 'item not found');
	if (arrival.status !== 'needs_review') error(400, 'source item is not an arrival');
	if (target.type !== arrival.type) error(400, 'type mismatch');

	const fileRows = await db
		.select()
		.from(itemFiles)
		.where(and(inArray(itemFiles.itemId, [targetId, arrivalId]), eq(itemFiles.kind, 'original')));
	const targetOriginal = fileRows.find((row) => row.itemId === targetId);
	const arrivalOriginal = fileRows.find((row) => row.itemId === arrivalId);
	if (!targetOriginal || !arrivalOriginal) error(500, 'missing original file row');

	// Stream the new master into the target's namespace before touching the DB,
	// so a failed copy leaves everything untouched.
	const ext = arrivalOriginal.storageKey.split('.').pop() ?? 'bin';
	const nextKey = `media/${targetId}/original.${ext}`;
	const got = await storage.get(arrivalOriginal.storageKey);
	if (!got) error(500, 'arrival media unreadable');
	await storage.put(nextKey, got.stream, { contentType: arrivalOriginal.mime });

	await db
		.update(items)
		.set({
			sha256: arrival.sha256,
			sizeBytes: arrival.sizeBytes,
			width: arrival.width,
			height: arrival.height,
			duration: arrival.duration,
			ingestName: arrival.ingestName ?? target.ingestName
		})
		.where(eq(items.id, targetId));
	await db
		.update(itemFiles)
		.set({
			storageKey: nextKey,
			mime: arrivalOriginal.mime,
			width: arrival.width,
			height: arrival.height
		})
		.where(eq(itemFiles.id, targetOriginal.id));
	if (targetOriginal.storageKey !== nextKey) await storage.delete(targetOriginal.storageKey);

	// Regenerate everything derived from the master. Poster time and all other
	// curation stay put — the re-render is the same footage.
	await queue.enqueue('derivatives', { itemId: targetId });
	if (target.type === 'video') {
		await queue.enqueue('sprite', { itemId: targetId });
		await queue.enqueue('transcode', { itemId: targetId });
		await queue.enqueue('hls', { itemId: targetId });
	}
	if (opts.faces) await queue.enqueue('face_scan', { itemId: targetId });

	await hardDeleteItems(db, storage, [arrivalId]);
	await reindexItem(db, targetId);
}
