import { json } from '@sveltejs/kit';
import { failure, register } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Creates an account; the platform checks the fields and answers with one message per field. */
export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
	const text = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string) : '');
	try {
		return json({
			player: await register(event, {
				name: text('name').trim(),
				username: text('username'),
				password: text('password')
			})
		});
	} catch (e) {
		return failure(e);
	}
};
