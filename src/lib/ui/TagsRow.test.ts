import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TagsRow from './TagsRow.svelte';
import type { ItemDTO } from '$lib/dto';

const tags: ItemDTO['tags'] = [
	{ id: 't1', name: 'summer', kind: 'topic' },
	{ id: 't2', name: 'birthday', kind: 'holiday' }
];
const albums: ItemDTO['albums'] = [{ id: 'a1', title: 'VHS Tape 04' }];

describe('TagsRow', () => {
	it('renders the fixed label, tag names, and album titles', () => {
		const { body } = render(TagsRow, { props: { tags, albums } });
		expect(body).toContain('Tags');
		expect(body).toContain('summer');
		expect(body).toContain('birthday');
		expect(body).toContain('VHS Tape 04');
		expect(body).toContain('/?tags=t1');
	});

	it('does not emit italic, radius, or media-border styling', () => {
		const { body } = render(TagsRow, { props: { tags, albums } });
		expect(body).not.toContain('font-style: italic');
		expect(body).not.toContain('border-radius');
		expect(body).not.toContain('media-border');
	});
});
