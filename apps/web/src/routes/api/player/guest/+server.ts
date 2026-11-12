import { json } from '@sveltejs/kit';
import { failure, startGuest } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** "Play as guest": a new guest for this browser, named by the platform. */
export const POST: RequestHandler = async (event) => {
	try {
		const player = await startGuest(event);
		return json({ player }, { status: 201 });
	} catch (err) {
		return failure(err);
	}
};
