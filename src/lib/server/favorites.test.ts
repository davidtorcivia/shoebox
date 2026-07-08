import { describe, expect, it } from 'vitest';
import { makeItem, makeTestDb, makeUser, stubStorage } from '$lib/server/testing/db';
import { isFavorited, listFavorites, toggleFavorite } from './favorites';

describe('favorites', () => {
	it('toggles on and off and lists newest-saved first', async () => {
		const db = makeTestDb();
		const user = await makeUser(db);
		const a = await makeItem(db, { uploadedBy: user.id, status: 'ready' });
		const b = await makeItem(db, { uploadedBy: user.id, status: 'ready' });

		expect(await toggleFavorite(db, user.id, a.id)).toBe(true);
		expect(await isFavorited(db, user.id, a.id)).toBe(true);
		expect(await toggleFavorite(db, user.id, b.id)).toBe(true);

		const listed = (await listFavorites(db, stubStorage, user.id)).map((item) => item.id);
		// b was saved last, so it comes first.
		expect(listed).toEqual([b.id, a.id]);

		expect(await toggleFavorite(db, user.id, a.id)).toBe(false);
		expect(await isFavorited(db, user.id, a.id)).toBe(false);
		expect((await listFavorites(db, stubStorage, user.id)).map((i) => i.id)).toEqual([b.id]);
	});

	it('404s when favoriting a missing item', async () => {
		const db = makeTestDb();
		const user = await makeUser(db);
		await expect(toggleFavorite(db, user.id, 'nope')).rejects.toMatchObject({ status: 404 });
	});
});
