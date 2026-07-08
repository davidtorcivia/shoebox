import { describe, expect, it } from 'vitest';
import { makeItem, makeTestDb, makeUser } from '$lib/server/testing/db';
import { listReactions, toggleReaction } from './reactions';

describe('reactions', () => {
	it('aggregates counts, tracks the viewer, and toggles off', async () => {
		const db = makeTestDb();
		const me = await makeUser(db);
		const other = await makeUser(db);
		const item = await makeItem(db, { uploadedBy: me.id, status: 'ready' });

		await toggleReaction(db, item.id, me.id, '❤️');
		// Returned from the acting user's perspective (other just reacted).
		const afterOther = await toggleReaction(db, item.id, other.id, '❤️');
		expect(afterOther).toEqual([{ emoji: '❤️', count: 2, mine: true }]);

		const mine = await listReactions(db, item.id, me.id);
		expect(mine).toEqual([{ emoji: '❤️', count: 2, mine: true }]);

		const removed = await toggleReaction(db, item.id, me.id, '❤️');
		expect(removed).toEqual([{ emoji: '❤️', count: 1, mine: false }]);
	});

	it('rejects unsupported emoji and missing items', async () => {
		const db = makeTestDb();
		const me = await makeUser(db);
		const item = await makeItem(db, { uploadedBy: me.id, status: 'ready' });
		await expect(toggleReaction(db, item.id, me.id, '🦄')).rejects.toMatchObject({ status: 400 });
		await expect(toggleReaction(db, 'nope', me.id, '❤️')).rejects.toMatchObject({ status: 404 });
	});
});
