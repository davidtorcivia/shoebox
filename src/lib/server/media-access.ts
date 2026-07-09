import { and, eq, isNull } from 'drizzle-orm';
import { albumItems, albums, itemFiles, items, shares } from './db/schema';

const KEY_RE = /^media\/([A-Za-z0-9_-]+)\//;
const FULL_VIDEO_KINDS = new Set(['original', 'playback', 'hls']);

type ShareRow = typeof shares.$inferSelect;

/**
 * All valid, unexpired share tokens on the request that cover `itemId` (directly
 * as an item share, or via an album). With `requireDownload`, only shares that
 * permit downloads qualify.
 */
async function coveringShares(
	locals: App.Locals,
	itemId: string,
	opts: { requireDownload?: boolean } = {}
): Promise<ShareRow[]> {
	const tokens = locals.shareTokens ?? [];
	if (tokens.length === 0) return [];

	const alive = await locals.db
		.select({ id: items.id })
		.from(items)
		.where(and(eq(items.id, itemId), isNull(items.deletedAt)))
		.limit(1);
	if (alive.length === 0) return [];

	const now = Date.now();
	const out: ShareRow[] = [];
	for (const token of tokens) {
		const share = (
			await locals.db.select().from(shares).where(eq(shares.token, token)).limit(1)
		)[0];
		if (!share) continue;
		if (share.expiresAt && share.expiresAt.getTime() <= now) continue;
		if (opts.requireDownload && !share.allowDownload) continue;

		if (share.targetType === 'item') {
			if (share.targetId === itemId) out.push(share);
			continue;
		}

		const member = await locals.db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.innerJoin(albums, eq(albums.id, albumItems.albumId))
			.where(
				and(
					eq(albumItems.albumId, share.targetId),
					eq(albumItems.itemId, itemId),
					isNull(albums.deletedAt)
				)
			)
			.limit(1);
		if (member.length > 0) out.push(share);
	}

	return out;
}

/**
 * The first valid share covering `itemId`, or null. Returned so callers can
 * honour its scope (e.g. a segment share bounds a clip download).
 */
export async function getCoveringShare(
	locals: App.Locals,
	itemId: string,
	opts: { requireDownload?: boolean } = {}
): Promise<ShareRow | null> {
	return (await coveringShares(locals, itemId, opts))[0] ?? null;
}

/**
 * Whether the current request may access media for `itemId` — a logged-in user,
 * or a share viewer whose token covers it. Item-granularity companion to
 * {@link canAccessMedia}, for endpoints (like clip export) not keyed by a path.
 */
export async function canAccessItem(
	locals: App.Locals,
	itemId: string,
	opts: { requireDownload?: boolean } = {}
): Promise<boolean> {
	if (locals.user) return true;
	return (await coveringShares(locals, itemId, opts)).length > 0;
}

/**
 * Whether the current request may fetch the media file at `key`. Logged-in users
 * always may. A share viewer may fetch:
 *  - the pre-cut clip served to their segment share;
 *  - for a full item/album share: everything, but the `original` only if the
 *    share permits downloads;
 *  - for a *segment* share (pre-cut): only the low-res poster/thumbnails — never
 *    the full-resolution video (original/playback/hls).
 */
export async function canAccessMedia(locals: App.Locals, key: string): Promise<boolean> {
	if (locals.user) return true;

	const tokens = locals.shareTokens ?? [];
	if (tokens.length === 0) return false;

	const match = KEY_RE.exec(key);
	if (!match) return false;
	const itemId = match[1];

	const covering = await coveringShares(locals, itemId);
	if (covering.length === 0) return false;

	// A viewer may always fetch the clip that was cut for their segment share.
	if (covering.some((share) => share.clipKey === key)) return true;

	// Otherwise the key must be a real derivative of this item.
	const file = (
		await locals.db
			.select({ kind: itemFiles.kind })
			.from(itemFiles)
			.where(and(eq(itemFiles.itemId, itemId), eq(itemFiles.storageKey, key)))
			.limit(1)
	)[0];
	if (!file) return false;
	const isFullVideo = FULL_VIDEO_KINDS.has(file.kind);
	const isOriginal = file.kind === 'original';

	const full = covering.filter((share) => share.segmentStart == null);
	const looseSegment = covering.filter(
		(share) => share.segmentStart != null && share.clipKey == null
	);
	const cutSegment = covering.filter(
		(share) => share.segmentStart != null && share.clipKey != null
	);

	// A full item/album share grants normal access — but the downloadable original
	// requires the share to permit downloads.
	if (full.length > 0) return isOriginal ? full.some((share) => share.allowDownload) : true;

	// A segment share that couldn't be pre-cut (no ffmpeg) falls back to the
	// client-bounded full video, so the link still plays.
	if (looseSegment.length > 0)
		return isOriginal ? looseSegment.some((share) => share.allowDownload) : true;

	// Only pre-cut segment shares cover this item: the full video is off-limits;
	// the poster/thumbnails are fine (needed to render the card and poster).
	if (cutSegment.length > 0) return !isFullVideo;

	return false;
}
