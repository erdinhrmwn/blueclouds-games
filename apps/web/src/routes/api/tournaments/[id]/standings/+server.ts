import { json } from '@sveltejs/kit';
import { apiError, failure, tournamentStandings } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tournament's standings, for its Detail and the card at a table after a match. */
export const GET: RequestHandler = async (event) => {
	if (!UUID.test(event.params.id)) {
		return apiError(404, 'not_found', 'There is no such tournament.');
	}

	try {
		const standings = await tournamentStandings(event, event.params.id);
		return json({ standings }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		return failure(err);
	}
};
