import type { ItemDTO } from '$lib/types';

export function formatDuration(seconds: number | null): string | null {
	if (seconds === null) return null;
	const total = Math.max(0, Math.round(seconds));
	const minutes = Math.floor(total / 60);
	const remainder = total % 60;
	return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function thumbSrcset(item: ItemDTO): string {
	return [
		`${item.urls.thumb400} 400w`,
		`${item.urls.thumb800} 800w`,
		`${item.urls.thumb1600} 1600w`
	].join(', ');
}

export function captionRight(item: ItemDTO): string {
	if (item.people.length > 0) return item.people.map((person) => person.name).join(' · ');
	if (item.tags.length > 0) return item.tags[0].name;
	return item.title ?? '';
}

export function spriteStyle(item: ItemDTO, frame = 0): string {
	if (!item.urls.sprite) return '';
	return `background-image: url("${item.urls.sprite}"); background-position-x: -${Math.max(0, frame) * 100}%`;
}

