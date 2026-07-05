import { json } from '@sveltejs/kit';
import pkg from '../../../package.json' with { type: 'json' };
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ ok: true, version: pkg.version });
