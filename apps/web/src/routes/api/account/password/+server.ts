import { json } from '@sveltejs/kit';
import { changePassword, failure } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Changes the signed-in account's password. Every other device is signed out; this one stays in. */
export const PUT: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
	const text = (key: string) => (typeof body?.[key] === 'string' ? (body[key] as string) : '');
	const fields = { currentPassword: text('currentPassword'), newPassword: text('newPassword') };

	try {
		await changePassword(event, fields);
		return json({ changed: true });
	} catch (err) {
		return failure(err);
	}
};
