import { describe, expect, it } from 'vitest';
import type { ItemDTO } from '$lib/types';
import { ageCaption } from './age-caption';

const item = (
	people: { id: string; slug: string; name: string; accentColor: string; age?: number }[]
) => ({ people }) as unknown as ItemDTO;

describe('ageCaption', () => {
	it('returns "age N" for the tagged person', () => {
		expect(
			ageCaption(item([{ id: 'p1', slug: 'm', name: 'M', accentColor: '#FA7B62', age: 53 }]), 'p1')
		).toBe('age 53');
	});

	it('returns null when the person has no age on this item', () => {
		expect(
			ageCaption(item([{ id: 'p1', slug: 'm', name: 'M', accentColor: '#FA7B62' }]), 'p1')
		).toBeNull();
	});

	it('returns null when the person is not on the item', () => {
		expect(ageCaption(item([]), 'p1')).toBeNull();
	});

	it('treats age 0 as valid', () => {
		expect(
			ageCaption(item([{ id: 'p1', slug: 'm', name: 'M', accentColor: '#FA7B62', age: 0 }]), 'p1')
		).toBe('age 0');
	});
});
