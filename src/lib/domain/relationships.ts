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

/**
 * Given the edges a user set by hand, derive the extra edges that follow
 * naturally from them, so the family tree stays consistent no matter which
 * person you edit from. Two rules, run to a fixpoint:
 *
 *  1. Declared siblings share parents. If A and B are siblings (an explicit
 *     `sibling-of` edge) and P is a parent of A, then P is a parent of B too —
 *     this is the "add a parent and it shows up for both" behaviour.
 *  2. A shared parent implies siblinghood. If P is a parent of both A and B
 *     then A and B are siblings.
 *
 * Parent propagation (rule 1) only crosses *declared* sibling edges, never the
 * ones rule 2 invents. That keeps half-siblings correct: two people who merely
 * share one parent become siblings, but their other (distinct) parents are not
 * forced onto each other.
 *
 * Returns the canonical edges that are implied but not already in `manual`.
 * Spouse edges are symmetric-only and never generate inferences.
 */
export function inferRelationships(manual: Rel[]): Rel[] {
	const parentKey = (parent: string, child: string) => `${parent}>${child}`;
	const sibKey = (a: string, b: string) => (a <= b ? `${a}|${b}` : `${b}|${a}`);

	const originalParents = new Set<string>();
	const originalSiblings = new Set<string>();
	const declaredSiblings: [string, string][] = [];
	for (const rel of manual) {
		if (rel.type === 'parent-of') {
			originalParents.add(parentKey(rel.personA, rel.personB));
		} else if (rel.type === 'sibling-of') {
			originalSiblings.add(sibKey(rel.personA, rel.personB));
			declaredSiblings.push([rel.personA, rel.personB]);
		}
	}

	const parents = new Set(originalParents);

	// Rule 1 to a fixpoint: every time a declared sibling gains a parent, the
	// other sibling must gain it too, which can cascade along sibling chains.
	let changed = true;
	while (changed) {
		changed = false;
		const parentsByChild = new Map<string, Set<string>>();
		for (const key of parents) {
			const [parent, child] = key.split('>');
			(parentsByChild.get(child) ?? parentsByChild.set(child, new Set()).get(child)!).add(parent);
		}
		for (const [a, b] of declaredSiblings) {
			for (const parent of parentsByChild.get(a) ?? []) {
				if (!parents.has(parentKey(parent, b))) {
					parents.add(parentKey(parent, b));
					changed = true;
				}
			}
			for (const parent of parentsByChild.get(b) ?? []) {
				if (!parents.has(parentKey(parent, a))) {
					parents.add(parentKey(parent, a));
					changed = true;
				}
			}
		}
	}

	// Rule 2: children of the same parent are siblings. These do not feed rule 1.
	const childrenByParent = new Map<string, string[]>();
	for (const key of parents) {
		const [parent, child] = key.split('>');
		(childrenByParent.get(parent) ?? childrenByParent.set(parent, []).get(parent)!).push(child);
	}
	const siblings = new Set(originalSiblings);
	for (const kids of childrenByParent.values()) {
		for (let i = 0; i < kids.length; i++) {
			for (let j = i + 1; j < kids.length; j++) {
				if (kids[i] !== kids[j]) siblings.add(sibKey(kids[i], kids[j]));
			}
		}
	}

	const out: Rel[] = [];
	for (const key of parents) {
		if (originalParents.has(key)) continue;
		const [personA, personB] = key.split('>');
		out.push({ personA, personB, type: 'parent-of' });
	}
	for (const key of siblings) {
		if (originalSiblings.has(key)) continue;
		const [personA, personB] = key.split('|');
		out.push({ personA, personB, type: 'sibling-of' });
	}
	return out;
}
