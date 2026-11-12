import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { apiError, BUSY_MESSAGE, failure, roomFor } from '#lib/server/platform.ts';
import { hasRooms, issueRoomToken } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

/** A room token, only for a room the platform made and this player may enter. */
export const POST: RequestHandler = async (event) => {
	const { params } = event;
	if (!hasRooms(params.game)) {
		return apiError(404, 'not_found', 'There is no such game.');
	}
	if (!isRoomCode(params.code)) {
		return apiError(400, 'bad_input', 'A table code is 4–8 letters or digits.');
	}

	// The platform decides who may enter; only then does the engine hand out a token.
	try {
		await roomFor(event, params.game, params.code);
	} catch (err) {
		return failure(err);
	}

	try {
		const access = await issueRoomToken(params.game, params.code);
		return json(access, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.error('room token failed', String(err));
		return apiError(503, 'unavailable', BUSY_MESSAGE);
	}
};
