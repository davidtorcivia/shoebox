export interface CropRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface PersonRef {
	id: string;
	name: string;
	accentColor: string;
}

export interface PersonListDTO extends PersonRef {
	birthdate: string | null;
	deathDate: string | null;
	avatarItemId: string | null;
	avatarCrop: CropRect | null;
	avatarUrl: string | null;
	itemCount: number;
}

export interface FamilyRefs {
	parents: PersonRef[];
	children: PersonRef[];
	spouses: PersonRef[];
	siblings: PersonRef[];
	grandparents: PersonRef[];
	grandchildren: PersonRef[];
}

export interface PersonDetailDTO extends PersonListDTO {
	birthPlace: string | null;
	bio: string | null;
	family: FamilyRefs;
	years: { year: number; count: number; age: number | null }[];
	stats: {
		moments: number;
		onFilm: { from: number; to: number } | null;
		albums: number;
	};
	linkedUsername: string | null;
}
