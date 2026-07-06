import { json } from '@sveltejs/kit';
import {
	createItem,
	listItems,
	type CreateItemInput,
	type ListItemsQuery
} from '$lib/server/items';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, 'user');
	return json(await listItems(locals.db, locals.platform.storage, queryFromUrl(url)));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'uploader');
	const body = (await request.json()) as Omit<CreateItemInput, 'uploadedBy'>;
	const item = await createItem(locals.db, locals.platform.storage, locals.platform.queue, {
		...body,
		uploadedBy: user.id
	});
	return json({ item }, { status: 201 });
};

function queryFromUrl(url: URL): ListItemsQuery {
	return {
		year: intParam(url, 'year'),
		month: intParam(url, 'month'),
		people: csvParam(url, 'people'),
		tags: csvParam(url, 'tags'),
		type: enumParam(url, 'type', ['video', 'photo']),
		album: stringParam(url, 'album'),
		status: enumParam(url, 'status', ['processing', 'needs_review', 'ready']),
		q: stringParam(url, 'q'),
		cursor: stringParam(url, 'cursor'),
		limit: intParam(url, 'limit')
	};
}

function intParam(url: URL, name: string): number | undefined {
	const raw = url.searchParams.get(name);
	if (!raw) return undefined;
	const value = Number(raw);
	return Number.isInteger(value) ? value : undefined;
}

function csvParam(url: URL, name: string): string[] | undefined {
	const raw = url.searchParams.get(name);
	if (!raw) return undefined;
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function stringParam(url: URL, name: string): string | undefined {
	const raw = url.searchParams.get(name)?.trim();
	return raw ? raw : undefined;
}

function enumParam<T extends string>(url: URL, name: string, allowed: readonly T[]): T | undefined {
	const raw = stringParam(url, name);
	return allowed.includes(raw as T) ? (raw as T) : undefined;
}
