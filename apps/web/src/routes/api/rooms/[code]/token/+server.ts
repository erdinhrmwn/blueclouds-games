import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { issueRoomToken } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	if (!isRoomCode(params.code)) {
		return json({ error: { code: 'bad_input', message: 'A table code is 4–8 letters or digits.' } }, { status: 400 });
	}
	try {
		return json(await issueRoomToken(params.code), { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.error('room token failed', String(err));
		return json({ error: { code: 'unavailable', message: 'The game server is busy. Try again in a moment.' } }, { status: 503 });
	}
};
