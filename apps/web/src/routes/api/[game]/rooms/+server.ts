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
		const rooms = list.map(({ code, name, host, players, maxPlayers, phase }) => ({
			code,
			name,
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

/** A table name: up to this many characters, blank means none. */
const NAME_MAX = 32;

/**
 * Opens a new table, private unless `{ visibility: 'public' }`, with an optional `name`. The platform picks the
 * code; the browser never makes one up.
 */
export const POST: RequestHandler = async (event) => {
	if (!hasRooms(event.params.game)) {
		return apiError(404, 'not_found', 'There is no such game.');
	}

	const body = (await event.request.json().catch(() => null)) as {
		visibility?: unknown;
		name?: unknown;
	} | null;
	const visibility: Visibility = body?.visibility === 'public' ? 'public' : 'private';

	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (name.length > NAME_MAX) {
		return apiError(400, 'invalid', `A table name is at most ${NAME_MAX} characters.`);
	}

	try {
		const { code } = await createRoom(event, event.params.game, visibility, name || null);
		return json({ code }, { status: 201 });
	} catch (err) {
		return failure(err);
	}
};
