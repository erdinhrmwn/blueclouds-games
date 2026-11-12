import { json } from '@sveltejs/kit';
import { apiError, failure, joinTournament, leaveTournament } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unknownTournament = () => apiError(404, 'not_found', 'There is no such tournament.');

/** Signs the player up for a tournament. */
export const POST: RequestHandler = async (event) => {
	if (!UUID.test(event.params.id)) {
		return unknownTournament();
	}

	try {
		await joinTournament(event, event.params.id);
		return json({ registered: true });
	} catch (err) {
		return failure(err);
	}
};

/** Signs the player out again, while sign-up is open. */
export const DELETE: RequestHandler = async (event) => {
	if (!UUID.test(event.params.id)) {
		return unknownTournament();
	}

	try {
		await leaveTournament(event, event.params.id);
		return json({ registered: false });
	} catch (err) {
		return failure(err);
	}
};
