import { json } from '@sveltejs/kit';
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
