import { json } from '@sveltejs/kit';
import { failure, login } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
	const text = (key: string) => (typeof body?.[key] === 'string' ? (body[key] as string) : '');
	const fields = { username: text('username'), password: text('password') };

	try {
		const player = await login(event, fields);
		return json({ player });
	} catch (err) {
		return failure(err);
	}
};
