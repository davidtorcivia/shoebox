import { describe, expect, it } from 'vitest';
import { canonicalRel, familyOf, type Rel } from './relationships';

const rel = (personA: string, personB: string, type: Rel['type']): Rel => ({
	personA,
	personB,
	type
});

describe('canonicalRel', () => {
	it('leaves parent-of untouched even when personA is greater than personB', () => {
		expect(canonicalRel(rel('zed', 'ann', 'parent-of'))).toEqual(rel('zed', 'ann', 'parent-of'));
	});

	it('swaps spouse-of so personA is less than personB', () => {
		expect(canonicalRel(rel('frank', 'ann', 'spouse-of'))).toEqual(
			rel('ann', 'frank', 'spouse-of')
		);
	});

	it('swaps sibling-of so personA is less than personB', () => {
		expect(canonicalRel(rel('rose', 'meg', 'sibling-of'))).toEqual(
			rel('meg', 'rose', 'sibling-of')
		);
	});

	it('is a no-op on already-canonical rels', () => {
		expect(canonicalRel(rel('ann', 'frank', 'spouse-of'))).toEqual(
			rel('ann', 'frank', 'spouse-of')
		);
	});
});

describe('familyOf', () => {
	it('returns six empty arrays when there are no rels', () => {
		expect(familyOf('meg', [])).toEqual({
			parents: [],
			children: [],
			spouses: [],
			siblings: [],
			grandparents: [],
			grandchildren: []
		});
	});

	it('derives parents and children from stored parent-to-child edges', () => {
		const rels = [
			rel('ann', 'meg', 'parent-of'),
			rel('meg', 'carol', 'parent-of'),
			rel('meg', 'joe', 'parent-of')
		];
		const family = familyOf('meg', rels);
		expect(family.parents).toEqual(['ann']);
		expect(family.children).toEqual(['carol', 'joe']);
	});

	it('derives spouses regardless of stored direction', () => {
		expect(familyOf('meg', [rel('frank', 'meg', 'spouse-of')]).spouses).toEqual(['frank']);
		expect(familyOf('meg', [rel('meg', 'zeb', 'spouse-of')]).spouses).toEqual(['zeb']);
	});

	it('derives siblings regardless of stored direction', () => {
		expect(familyOf('meg', [rel('meg', 'rose', 'sibling-of')]).siblings).toEqual(['rose']);
		expect(familyOf('meg', [rel('bea', 'meg', 'sibling-of')]).siblings).toEqual(['bea']);
	});

	it('derives grandparents via two parent-of hops on both sides', () => {
		const rels = [
			rel('gma-m', 'mom', 'parent-of'),
			rel('gpa-m', 'mom', 'parent-of'),
			rel('gma-p', 'dad', 'parent-of'),
			rel('mom', 'meg', 'parent-of'),
			rel('dad', 'meg', 'parent-of')
		];
		expect(familyOf('meg', rels).grandparents).toEqual(['gma-m', 'gma-p', 'gpa-m']);
	});

	it('derives grandchildren via two parent-of hops', () => {
		const rels = [
			rel('meg', 'davidsr', 'parent-of'),
			rel('meg', 'carol', 'parent-of'),
			rel('davidsr', 'david', 'parent-of'),
			rel('davidsr', 'eric', 'parent-of')
		];
		expect(familyOf('meg', rels).grandchildren).toEqual(['david', 'eric']);
	});

	it('deduplicates and sorts every bucket', () => {
		const rels = [
			rel('meg', 'carol', 'parent-of'),
			rel('meg', 'carol', 'parent-of'),
			rel('carol', 'kid', 'parent-of'),
			rel('carol', 'kid', 'parent-of')
		];
		const family = familyOf('meg', rels);
		expect(family.children).toEqual(['carol']);
		expect(family.grandchildren).toEqual(['kid']);
	});

	it('never includes the person themself in degenerate cycles', () => {
		const rels = [rel('a', 'meg', 'parent-of'), rel('meg', 'a', 'parent-of')];
		const family = familyOf('meg', rels);
		expect(family.grandparents).toEqual([]);
		expect(family.grandchildren).toEqual([]);
	});

	it('ignores rels not connected to the person', () => {
		expect(familyOf('meg', [rel('x', 'y', 'parent-of'), rel('x', 'y', 'spouse-of')])).toEqual(
			{
				parents: [],
				children: [],
				spouses: [],
				siblings: [],
				grandparents: [],
				grandchildren: []
			}
		);
	});
});
