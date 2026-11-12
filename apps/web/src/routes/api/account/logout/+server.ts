import { json } from '@sveltejs/kit';
import { failure, logout } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		await logout(event);
		return json({ signedOut: true });
	} catch (err) {
		return failure(err);
	}
};
