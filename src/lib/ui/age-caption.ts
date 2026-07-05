import type { ItemDTO } from '$lib/types';

export function ageCaption(item: ItemDTO, personId: string): string | null {
	const person = item.people.find((candidate) => candidate.id === personId);
	return person?.age != null ? `age ${person.age}` : null;
}
