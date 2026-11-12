import { json } from '@sveltejs/kit';
import { apiError, failure, tournamentsFor } from '#lib/server/platform.ts';
import { hasRooms } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

/** The game's tournaments open for sign-up, and the player's own tournament tables. */
export const GET: RequestHandler = async (event) => {
	if (!hasRooms(event.params.game)) {
		return apiError(404, 'not_found', 'There is no such game.');
	}

	try {
		const result = await tournamentsFor(event, event.params.game);
		return json(result, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		return failure(err);
	}
};
