import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { failure, roomFor } from '#lib/server/platform.ts';
import { hasRooms, issueRoomToken } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

/** A room token, only for a room the platform made and this player may enter. */
export const POST: RequestHandler = async (event) => {
	const { params } = event;
	if (!hasRooms(params.game)) {
		return json({ error: { code: 'not_found', message: 'There is no such game.' } }, { status: 404 });
	}
	if (!isRoomCode(params.code)) {
		return json({ error: { code: 'bad_input', message: 'A table code is 4–8 letters or digits.' } }, { status: 400 });
	}
	try {
		await roomFor(event, params.game, params.code);
	} catch (e) {
		return failure(e);
	}
	try {
		return json(await issueRoomToken(params.game, params.code), { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.error('room token failed', String(err));
		return json({ error: { code: 'unavailable', message: 'The game server is busy. Try again in a moment.' } }, { status: 503 });
	}
};
