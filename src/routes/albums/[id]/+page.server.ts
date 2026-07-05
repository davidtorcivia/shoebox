import { error, redirect } from '@sveltejs/kit';
import { canEditAlbum, getAlbumDetail } from '$lib/server/albums';
import { getItemDTOsByIds } from '$lib/server/items';
import { ROLE_RANK } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');
	const detail = await getAlbumDetail(locals.db, locals.platform.storage, params.id);
	if (!detail) error(404, 'Album not found');
	const items = await getItemDTOsByIds(locals.db, locals.platform.storage, detail.itemIds);
	return {
		album: detail.album,
		items,
		canEdit: canEditAlbum(locals.user, detail.album),
		canShare: ROLE_RANK[locals.user.role] >= ROLE_RANK.editor,
		canExport: locals.platform.features.serverDerivatives
	};
};
