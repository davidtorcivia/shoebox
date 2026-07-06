import type { ItemDate } from '$lib/domain/dates';

export interface ItemDTO {
	id: string;
	type: 'video' | 'photo';
	title: string | null;
	description: string | null;
	date: ItemDate;
	displayDate: string;
	shortDate: string;
	duration: number | null;
	width: number;
	height: number;
	status: 'processing' | 'needs_review' | 'ready';
	urls: {
		poster: string;
		thumb400: string;
		thumb800: string;
		thumb1600: string;
		original?: string;
		sprite?: string;
	};
	blurhash: string | null;
	people: { id: string; slug: string; name: string; accentColor: string; age?: number }[];
	tags: { id: string; name: string; kind: 'topic' | 'holiday' }[];
	albums: { id: string; title: string }[];
	uploadedBy: string;
	tapeLabel: string | null;
}

export interface UploadMeta {
	type: 'video' | 'photo';
	width: number;
	height: number;
	duration: number | null;
	title: string | null;
	description: string | null;
	tapeLabel: string | null;
	date: ItemDate;
	people: string[];
	tags: string[];
}

export interface PersonListDTO {
	id: string;
	name: string;
	birthdate: string | null;
	deathDate: string | null;
	birthPlace: string | null;
	accentColor: string;
	avatarItemId: string | null;
}
