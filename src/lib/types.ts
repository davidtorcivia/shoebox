import type { ItemDate } from '$lib/domain/dates';
import type { CropRect } from '$lib/domain/people-dto';

export interface ItemDTO {
	id: string;
	type: 'video' | 'photo';
	title: string | null;
	description: string | null;
	date: ItemDate;
	displayDate: string;
	shortDate: string;
	duration: number | null;
	posterTime: number | null;
	width: number;
	height: number;
	status: 'processing' | 'needs_review' | 'ready';
	urls: {
		poster: string;
		thumb400: string;
		thumb800: string;
		thumb1600: string;
		original?: string;
		playback?: string;
		sprite?: string;
	};
	/** False when `urls.original` is a format the browser can't render (HEIC,
	 * camera RAW): the detail view shows the webp derivative and offers the
	 * original only for download. */
	originalWebSafe: boolean;
	blurhash: string | null;
	people: {
		id: string;
		slug: string;
		name: string;
		accentColor: string;
		avatarUrl?: string | null;
		avatarCrop?: CropRect | null;
		age?: number;
		ageApprox?: boolean;
	}[];
	tags: { id: string; name: string; kind: 'topic' | 'holiday' }[];
	albums: { id: string; title: string }[];
	uploadedBy: string;
	tapeLabel: string | null;
	location: string | null;
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
