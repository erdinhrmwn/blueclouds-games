import { json } from '@sveltejs/kit';
import { failure, playToken } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** A 15-minute token for connecting to a room. */
export const POST: RequestHandler = async (event) => {
	try {
		return json({ token: await playToken(event) });
	} catch (e) {
		return failure(e);
	}
};
