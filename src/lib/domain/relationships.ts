export type RelType = 'parent-of' | 'spouse-of' | 'sibling-of';

export interface Rel {
	personA: string;
	personB: string;
	type: RelType;
}

export interface FamilyIds {
	parents: string[];
	children: string[];
	spouses: string[];
	siblings: string[];
	grandparents: string[];
	grandchildren: string[];
}

export function canonicalRel(rel: Rel): Rel {
	if (rel.type === 'parent-of' || rel.personA <= rel.personB) return rel;
	return { personA: rel.personB, personB: rel.personA, type: rel.type };
}

export function familyOf(personId: string, rels: Rel[]): FamilyIds {
	const parentsOf = (id: string): string[] =>
		rels.filter((rel) => rel.type === 'parent-of' && rel.personB === id).map((rel) => rel.personA);
	const childrenOf = (id: string): string[] =>
		rels.filter((rel) => rel.type === 'parent-of' && rel.personA === id).map((rel) => rel.personB);
	const symmetric = (type: Extract<RelType, 'spouse-of' | 'sibling-of'>): string[] =>
		rels
			.filter((rel) => rel.type === type && (rel.personA === personId || rel.personB === personId))
			.map((rel) => (rel.personA === personId ? rel.personB : rel.personA));

	const parents = parentsOf(personId);
	const children = childrenOf(personId);

	return {
		parents: uniqSortedExcluding(parents, personId),
		children: uniqSortedExcluding(children, personId),
		spouses: uniqSortedExcluding(symmetric('spouse-of'), personId),
		siblings: uniqSortedExcluding(symmetric('sibling-of'), personId),
		grandparents: uniqSortedExcluding(parents.flatMap(parentsOf), personId),
		grandchildren: uniqSortedExcluding(children.flatMap(childrenOf), personId)
	};
}

function uniqSortedExcluding(ids: string[], exclude: string): string[] {
	return [...new Set(ids)].filter((id) => id !== exclude).sort();
}
