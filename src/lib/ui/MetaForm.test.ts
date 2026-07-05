import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MetaForm, { buildMetaPayload } from './MetaForm.svelte';
import type { ItemDTO } from '$lib/dto';

const item: ItemDTO = {
	id: 'i1',
	type: 'video',
	title: 'Backyard',
	description: 'Sprinkler day',
	date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
	displayDate: 'June 14, 1994',
	shortDate: 'Jun 14',
	duration: 42,
	width: 1920,
	height: 1080,
	status: 'ready',
	urls: {
		poster: '/poster.webp',
		thumb400: '/thumb_400.webp',
		thumb800: '/thumb_800.webp',
		thumb1600: '/thumb_1600.webp',
		original: '/original.mp4'
	},
	blurhash: null,
	people: [
		{ id: 'p_mom', name: 'Mom', accentColor: '#FA7B62' },
		{ id: 'p_dad', name: 'Dad', accentColor: '#C3272B' }
	],
	tags: [{ id: 't1', name: 'Summer', kind: 'topic' }],
	albums: [],
	uploadedBy: 'u1',
	tapeLabel: 'Tape 04'
};

describe('MetaForm', () => {
	it('renders the contracted field names', () => {
		const { body } = render(MetaForm, { props: { item, onsubmit: () => undefined } });
		for (const name of [
			'title',
			'description',
			'dateStart',
			'dateEnd',
			'datePrecision',
			'tapeLabel',
			'people',
			'tags'
		]) {
			expect(body).toContain(`name="${name}"`);
		}
	});

	it('builds lowercased tags while preserving person ids', () => {
		expect(
			buildMetaPayload({
				title: ' Backyard ',
				description: ' Updated ',
				date: { dateStart: '1995-01-01', dateEnd: '1995-12-31', precision: 'year' },
				tapeLabel: ' Tape 05 ',
				peopleText: 'p_mom, p_dad',
				tagsText: ' Summer, CHRISTMAS, summer '
			})
		).toEqual({
			title: 'Backyard',
			description: 'Updated',
			dateStart: '1995-01-01',
			dateEnd: '1995-12-31',
			datePrecision: 'year',
			tapeLabel: 'Tape 05',
			people: ['p_mom', 'p_dad'],
			tags: ['summer', 'christmas']
		});
	});
});
