import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { albums, items } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { createShare, listShares } from '$lib/server/shares';
import type { RequestHandler } from './$types';

type ShareTarget = 'album' | 'item';

function expiresAtFrom(expiry: string | undefined | null): Date | null {
	if (!expiry || expiry === 'never') return null;
	if (expiry === '7d') return new Date(Date.now() + 7 * 86_400_000);
	if (expiry === '30d') return new Date(Date.now() + 30 * 86_400_000);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
		error(400, 'expiry must be never, 7d, 30d, or YYYY-MM-DD');
	}
	const date = new Date(`${expiry}T23:59:59Z`);
	if (Number.isNaN(date.getTime())) error(400, 'Invalid expiry date');
	return date;
}

async function assertTargetExists(
	db: Db,
	targetType: ShareTarget,
	targetId: string
): Promise<void> {
	const found =
		targetType === 'album'
			? await db
					.select({ id: albums.id })
					.from(albums)
					.where(and(eq(albums.id, targetId), isNull(albums.deletedAt)))
					.limit(1)
			: await db
					.select({ id: items.id })
					.from(items)
					.where(and(eq(items.id, targetId), isNull(items.deletedAt)))
					.limit(1);
	if (found.length === 0) error(404, 'Share target not found');
}

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, 'editor');
	const targetType = url.searchParams.get('targetType');
	const targetId = url.searchParams.get('targetId');
	const target: { targetType: ShareTarget; targetId: string } | undefined =
		(targetType === 'album' || targetType === 'item') && targetId
			? { targetType, targetId }
			: undefined;
	return json({ shares: await listShares(locals.db, target) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'editor');
	const body = (await request.json().catch(() => null)) as {
		targetType?: unknown;
		targetId?: unknown;
		password?: unknown;
		expiry?: unknown;
		allowDownload?: unknown;
	} | null;

	if (
		!body ||
		(body.targetType !== 'album' && body.targetType !== 'item') ||
		typeof body.targetId !== 'string' ||
		body.targetId.length === 0
	) {
		error(400, 'targetType (album|item) and targetId are required');
	}
	if (body.expiry !== undefined && body.expiry !== null && typeof body.expiry !== 'string') {
		error(400, 'expiry must be a string');
	}

	await assertTargetExists(locals.db, body.targetType, body.targetId);
	const password = typeof body.password === 'string' && body.password.trim() ? body.password : null;
	const share = await createShare(locals.db, {
		targetType: body.targetType,
		targetId: body.targetId,
		password,
		expiresAt: expiresAtFrom(body.expiry),
		allowDownload: body.allowDownload === true,
		createdBy: user.id
	});

	return json({ share, url: `/share/${share.token}` }, { status: 201 });
};
