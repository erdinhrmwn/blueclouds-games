import { json } from '@sveltejs/kit';
import { failure, playToken } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** A 15-minute token for connecting to a room. */
export const POST: RequestHandler = async (event) => {
	try {
		const token = await playToken(event);
		return json({ token });
	} catch (err) {
		return failure(err);
	}
};
