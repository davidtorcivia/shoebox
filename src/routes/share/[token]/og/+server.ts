import { redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { albumItems, albums, favorites, itemFiles } from '$lib/server/db/schema';
import type { Db } from '$lib/server/db';
import { getShareByToken } from '$lib/server/shares';
import type { RequestHandler } from './$types';

const OG_W = 1200;
const OG_H = 630;
const FALLBACK = '/og.png';

// Best thumbnail key for an item, largest first.
async function itemThumbKey(db: Db, itemId: string): Promise<string | null> {
	const files = await db
		.select({ kind: itemFiles.kind, key: itemFiles.storageKey })
		.from(itemFiles)
		.where(eq(itemFiles.itemId, itemId));
	for (const kind of ['thumb_1600', 'thumb_800', 'thumb_400', 'poster'] as const) {
		const file = files.find((f) => f.kind === kind);
		if (file) return file.key;
	}
	return null;
}

async function firstAlbumItem(db: Db, albumId: string): Promise<string | null> {
	const cover = (await db.select().from(albums).where(eq(albums.id, albumId)).limit(1))[0];
	if (cover?.coverItemId) return cover.coverItemId;
	const row = (
		await db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.where(eq(albumItems.albumId, albumId))
			.orderBy(asc(albumItems.position))
			.limit(1)
	)[0];
	return row?.itemId ?? null;
}

async function representativeKey(
	db: Db,
	share: { targetType: 'album' | 'item' | 'favorites'; targetId: string }
): Promise<string | null> {
	if (share.targetType === 'item') return itemThumbKey(db, share.targetId);
	if (share.targetType === 'album') {
		const itemId = await firstAlbumItem(db, share.targetId);
		return itemId ? itemThumbKey(db, itemId) : null;
	}
	// favorites: targetId is the owner id — use their most recent saved item.
	const fav = (
		await db
			.select({ itemId: favorites.itemId })
			.from(favorites)
			.where(eq(favorites.userId, share.targetId))
			.orderBy(asc(favorites.createdAt))
			.limit(1)
	)[0];
	return fav ? itemThumbKey(db, fav.itemId) : null;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	return Buffer.concat(chunks);
}

// A public, token-gated preview image for a shared link: the shared media itself,
// cropped to a 1200x630 card. Password-protected/expired/unknown shares fall back
// to the branded card so nothing behind a password ever leaks into a preview.
export const GET: RequestHandler = async ({ locals, params }) => {
	const share = await getShareByToken(locals.db, params.token);
	if (!share || share.hasPassword || (share.expiresAt && share.expiresAt.getTime() <= Date.now())) {
		redirect(302, FALLBACK);
	}

	const key = await representativeKey(locals.db, share);
	if (key) {
		const media = await locals.platform.storage.get(key).catch(() => null);
		if (media) {
			try {
				const bytes = await streamToBuffer(media.stream);
				const { default: sharp } = await import('sharp');
				const png = await sharp(bytes)
					.resize(OG_W, OG_H, { fit: 'cover', position: 'attention' })
					.png()
					.toBuffer();
				return new Response(png as unknown as BodyInit, {
					headers: {
						'content-type': 'image/png',
						'cache-control': 'public, max-age=3600'
					}
				});
			} catch {
				// sharp unavailable (non-node) or unreadable media — use the branded card.
			}
		}
	}

	redirect(302, FALLBACK);
};
