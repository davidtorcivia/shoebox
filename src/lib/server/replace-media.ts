/**
 * "Replace media" for arrivals: when a re-ingested file (say, a re-rendered
 * scan fixing a bad audio mix) shares its filename with an item already in the
 * library, the queue offers to swap the existing item's media in place —
 * keeping every bit of curation (title, date, people, tags, capture time,
 * poster choice) — and discard the fresh arrival instead of cataloging it twice.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { itemFiles, items } from '$lib/server/db/schema';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import { reindexItem } from '$lib/server/search';
import { hardDeleteItems } from '$lib/server/trash';
import { titleFromFilename } from '../../worker/conventions';
import { durationsCompatible, hammingHex64, PHASH_MATCH_DISTANCE } from '../../worker/phash';

export type ReplaceCandidate = {
	id: string;
	title: string | null;
	sortDate: string | null;
	thumbUrl: string;
	/** What linked the pair: the ingest filename (or filename-derived title for
	 * legacy items), or the perceptual hash of the footage itself. */
	matchedBy: 'name' | 'frame';
};

export type ArrivalKey = {
	id: string;
	type: 'video' | 'photo';
	ingestName: string | null;
	framePhash: string | null;
	duration: number | null;
};

/**
 * For each queued arrival, the ready library item it most plausibly re-renders.
 * Two tiers: (1) same ingest filename — or, for items ingested before filenames
 * were recorded, a title equal to the filename-derived title; (2) perceptual
 * match — closest mid-frame dHash within tolerance, with compatible duration —
 * which survives wholesale renaming. Oldest match wins a tie (the earliest
 * cataloged item is the curated one).
 */
export async function replaceCandidatesFor(
	db: Db,
	storage: StorageAdapter,
	arrivals: ArrivalKey[]
): Promise<Record<string, ReplaceCandidate>> {
	if (arrivals.length === 0) return {};
	const ready = await db
		.select({
			id: items.id,
			type: items.type,
			title: items.title,
			ingestName: items.ingestName,
			framePhash: items.framePhash,
			duration: items.duration,
			sortDate: items.sortDate,
			createdAt: items.createdAt,
			thumbKey: itemFiles.storageKey
		})
		.from(items)
		.leftJoin(itemFiles, and(eq(itemFiles.itemId, items.id), eq(itemFiles.kind, 'thumb_400')))
		.where(and(isNull(items.deletedAt), eq(items.status, 'ready')));
	ready.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

	const out: Record<string, ReplaceCandidate> = {};
	for (const arrival of arrivals) {
		const pool = ready.filter((row) => row.type === arrival.type && row.id !== arrival.id);

		let match: ((typeof ready)[number] & { matchedBy: 'name' | 'frame' }) | undefined;
		if (arrival.ingestName) {
			const derivedTitle = titleFromFilename(arrival.ingestName);
			const byName = pool.find(
				(row) =>
					row.ingestName === arrival.ingestName ||
					(row.ingestName == null && derivedTitle !== '' && row.title === derivedTitle)
			);
			if (byName) match = { ...byName, matchedBy: 'name' };
		}
		if (!match && arrival.framePhash) {
			let best: { row: (typeof ready)[number]; distance: number } | undefined;
			for (const row of pool) {
				if (!row.framePhash || !durationsCompatible(row.duration, arrival.duration)) continue;
				const distance = hammingHex64(row.framePhash, arrival.framePhash);
				if (distance <= PHASH_MATCH_DISTANCE && (!best || distance < best.distance)) {
					best = { row, distance };
				}
			}
			if (best) match = { ...best.row, matchedBy: 'frame' };
		}

		if (match) {
			out[arrival.id] = {
				id: match.id,
				title: match.title,
				sortDate: match.sortDate,
				thumbUrl: match.thumbKey ? await storage.mediaUrl(match.thumbKey) : '',
				matchedBy: match.matchedBy
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
			ingestName: arrival.ingestName ?? target.ingestName,
			framePhash: arrival.framePhash ?? target.framePhash
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
