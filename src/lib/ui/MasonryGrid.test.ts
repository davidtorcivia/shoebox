import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MasonryGrid from './MasonryGrid.svelte';
import type { ItemDTO } from '$lib/types';

const item: ItemDTO = {
	id: 'i1',
	type: 'photo',
	title: 'Lake',
	description: null,
	date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
	displayDate: 'June 14, 1994',
	shortDate: 'Jun 14',
	duration: null,
	width: 192,
	height: 108,
	status: 'ready',
	urls: {
		poster: '/poster.webp',
		thumb400: '/thumb_400.webp',
		thumb800: '/thumb_800.webp',
		thumb1600: '/thumb_1600.webp'
	},
	blurhash: null,
	people: [],
	tags: [{ id: 't1', name: 'lake', kind: 'topic' }],
	albums: [],
	uploadedBy: 'u1',
	tapeLabel: null
};

describe('MasonryGrid', () => {
	it('renders month breaks and media cards', () => {
		const { body } = render(MasonryGrid, { props: { items: [item], activeYear: 1994 } });
		expect(body).toContain('June 1994');
		expect(body).toContain('Open Lake');
		expect(body).toContain('lake');
	});

	it('renders an empty state', () => {
		const { body } = render(MasonryGrid, { props: { items: [], activeYear: 1994 } });
		expect(body).toContain('No moments yet for this year.');
	});
});
