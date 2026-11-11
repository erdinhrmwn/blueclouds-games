import { json } from '@sveltejs/kit';
import { listRooms } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json({ rooms: await listRooms() }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.error('room list failed', String(err));
		return json({ error: { code: 'unavailable', message: 'The game server is busy. Try again in a moment.' } }, { status: 503 });
	}
};
