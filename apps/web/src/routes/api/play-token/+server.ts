import { json } from '@sveltejs/kit';
import { failure, playToken, readName } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** A 15-minute token for connecting to a room. */
export const POST: RequestHandler = async (event) => {
	const name = await readName(event.request);
	try {
		return json({ token: await playToken(event, name) });
	} catch (e) {
		return failure(e);
	}
};
