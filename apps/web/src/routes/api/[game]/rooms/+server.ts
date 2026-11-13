import { json } from '@sveltejs/kit';
import {
	apiError,
	BUSY_MESSAGE,
	createRoom,
	failure,
	type Visibility
} from '#lib/server/platform.ts';
import { log } from '#lib/server/log.ts';
import { hasRooms, listRooms } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!hasRooms(params.game)) {
		return apiError(404, 'not_found', 'There is no such game.');
	}

	try {
		const list = await listRooms(params.game);
		// Seats are for the backoffice; the public list shows only counts and the host.
		const rooms = list.map(({ code, host, players, maxPlayers, phase }) => ({
			code,
			host,
			players,
			maxPlayers,
			phase
		}));

		return json({ rooms }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		log.error({ msg: 'room list failed', game: params.game, err });
		return apiError(503, 'unavailable', BUSY_MESSAGE);
	}
};

/** Opens a new table, private unless `{ visibility: 'public' }`. The platform picks the code; the browser never makes one up. */
export const POST: RequestHandler = async (event) => {
	if (!hasRooms(event.params.game)) {
		return apiError(404, 'not_found', 'There is no such game.');
	}

	const body = (await event.request.json().catch(() => null)) as { visibility?: unknown } | null;
	const visibility: Visibility = body?.visibility === 'public' ? 'public' : 'private';

	try {
		const { code } = await createRoom(event, event.params.game, visibility);
		return json({ code }, { status: 201 });
	} catch (err) {
		return failure(err);
	}
};
