import { json } from '@sveltejs/kit';
import { createRoom, failure, readName } from '#lib/server/platform.ts';
import { hasRooms, listRooms } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!hasRooms(params.game)) {
		return json({ error: { code: 'not_found', message: 'There is no such game.' } }, { status: 404 });
	}
	try {
		return json({ rooms: await listRooms(params.game) }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.error('room list failed', String(err));
		return json({ error: { code: 'unavailable', message: 'The game server is busy. Try again in a moment.' } }, { status: 503 });
	}
};

/** Opens a new table. The platform picks the code; the browser never makes one up. */
export const POST: RequestHandler = async (event) => {
	if (!hasRooms(event.params.game)) {
		return json({ error: { code: 'not_found', message: 'There is no such game.' } }, { status: 404 });
	}
	const name = await readName(event.request);
	try {
		const { code } = await createRoom(event, event.params.game, name);
		return json({ code }, { status: 201 });
	} catch (e) {
		return failure(e);
	}
};
