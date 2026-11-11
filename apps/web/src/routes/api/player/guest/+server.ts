import { json } from '@sveltejs/kit';
import { failure, startGuest } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** "Play as guest": a new guest for this browser, named by the platform. */
export const POST: RequestHandler = async (event) => {
	try {
		return json({ player: await startGuest(event) }, { status: 201 });
	} catch (e) {
		return failure(e);
	}
};
