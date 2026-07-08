import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MediaCard from './MediaCard.svelte';
import type { ItemDTO } from '$lib/types';

const item: ItemDTO = {
	id: 'i1',
	type: 'video',
	title: 'Tiny clip',
	description: null,
	date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
	displayDate: 'June 14, 1994',
	shortDate: 'Jun 14',
	duration: 42,
	posterTime: null,
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
	originalWebSafe: true,
	people: [{ id: 'p1', slug: 'dad', name: 'Dad', accentColor: '#FA7B62' }],
	tags: [],
	albums: [],
	uploadedBy: 'u1',
	tapeLabel: null,
	location: null
};

describe('MediaCard', () => {
	it('renders responsive media, duration, and caption text', () => {
		const { body } = render(MediaCard, { props: { item, activeYear: 1994 } });
		expect(body).toContain('Open Tiny clip');
		expect(body).toContain('0:42');
		expect(body).toContain('Jun 14');
		expect(body).toContain('Dad');
		expect(body).toContain('/thumb_800.webp');
	});
});
