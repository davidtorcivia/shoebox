export interface AlbumDTO {
	id: string;
	title: string;
	description: string | null;
	coverItemId: string | null;
	coverUrl: string | null;
	itemCount: number;
	createdBy: { id: string; username: string; accentColor: string };
	createdAt: string;
}
