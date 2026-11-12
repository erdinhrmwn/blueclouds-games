import { json } from '@sveltejs/kit';
import { failure, tournamentsFor } from '#lib/server/platform.ts';
import { hasRooms } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

/** The game's tournaments open for sign-up, and the player's own tournament tables. */
export const GET: RequestHandler = async (event) => {
	if (!hasRooms(event.params.game)) {
		return json(
			{ error: { code: 'not_found', message: 'There is no such game.' } },
			{ status: 404 }
		);
	}
	try {
		return json(await tournamentsFor(event, event.params.game), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (e) {
		return failure(e);
	}
};
