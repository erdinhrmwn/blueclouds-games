import { json } from '@sveltejs/kit';
import { failure, login } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
	const text = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string) : '');
	try {
		return json({ player: await login(event, { username: text('username'), password: text('password') }) });
	} catch (e) {
		return failure(e);
	}
};
