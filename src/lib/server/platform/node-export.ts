import { ZipArchive } from 'archiver';
import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { PassThrough, Readable } from 'node:stream';
import { getItemDTOsByIds } from '../items';
import { albumItems, albums, itemFiles } from '../db/schema';
import type { Db } from '../db';
import type { StorageAdapter } from './types';

function extOf(storageKey: string): string {
	const dot = storageKey.lastIndexOf('.');
	return dot === -1 ? '' : storageKey.slice(dot);
}

function slug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'album'
	);
}

export async function exportAlbumZip(
	db: Db,
	storage: StorageAdapter,
	albumId: string
): Promise<Response> {
	const album = (
		await db
			.select()
			.from(albums)
			.where(and(eq(albums.id, albumId), isNull(albums.deletedAt)))
			.limit(1)
	)[0];
	if (!album) error(404, 'Album not found');

	const members = await db
		.select({ itemId: albumItems.itemId })
		.from(albumItems)
		.where(eq(albumItems.albumId, albumId))
		.orderBy(asc(albumItems.position));
	const itemIds = members.map((member) => member.itemId);
	const items = await getItemDTOsByIds(db, storage, itemIds);
	const originals =
		itemIds.length === 0
			? []
			: await db
					.select()
					.from(itemFiles)
					.where(and(inArray(itemFiles.itemId, itemIds), eq(itemFiles.kind, 'original')));
	const originalsByItem = new Map(originals.map((file) => [file.itemId, file]));

	const archive = new ZipArchive({ store: true });
	const out = new PassThrough();
	archive.pipe(out);

	archive.append(
		JSON.stringify(
			{
				album: {
					id: album.id,
					title: album.title,
					description: album.description,
					exportedAt: new Date().toISOString()
				},
				items
			},
			null,
			2
		),
		{ name: 'metadata.json' }
	);

	void (async () => {
		try {
			for (const itemId of itemIds) {
				const file = originalsByItem.get(itemId);
				if (!file) continue;
				const object = await storage.get(file.storageKey);
				if (!object) continue;
				archive.append(
					Readable.fromWeb(object.stream as unknown as import('node:stream/web').ReadableStream),
					{ name: `originals/${file.itemId}${extOf(file.storageKey)}` }
				);
			}
			await archive.finalize();
		} catch (err) {
			archive.abort();
			out.destroy(err instanceof Error ? err : new Error(String(err)));
		}
	})();

	return new Response(Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>, {
		status: 200,
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${slug(album.title)}.zip"`,
			'cache-control': 'no-store'
		}
	});
}
