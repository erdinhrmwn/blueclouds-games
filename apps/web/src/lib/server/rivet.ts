import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';
import type { RoomSummary } from 'server/games/shared/schema';

/** How long a browser's engine token lasts; the Rivet client asks for a new one when it expires. */
const TOKEN_SECONDS = 15 * 60;

// The engine as this server reaches it, signed in with the admin token. Not as URL credentials:
// rivetkit also reads RIVET_TOKEN from env and refuses a token given both ways.
const admin = createClient<typeof registry>({
	endpoint: RIVET_ENDPOINT ?? PUBLIC_RIVET_ENDPOINT,
	namespace: 'default',
	token: RIVET_TOKEN,
	devtools: false
});

/** The parts of a room handle this file uses; the same for every game. */
type RoomHandle = Pick<ReturnType<typeof admin.bust31Room.getOrCreate>, 'resolve' | 'issueToken'>;

/** Each game's room actor, by game slug. */
const ROOMS = new Map<string, (code: string) => RoomHandle>([
	['bust-31', (code: string) => admin.bust31Room.getOrCreate([code])],
	['cloudburst', (code: string) => admin.cloudburstRoom.getOrCreate([code])]
]);

export const hasRooms = (game: string) => ROOMS.has(game);

/**
 * Creates the room if needed and returns a token that reaches only that room's actor.
 * Browsers can't reach other rooms, the room list, or anything else in the engine.
 * `game` must pass `hasRooms` first.
 */
export async function issueRoomToken(game: string, code: string): Promise<{ actorId: string; token: string }> {
	const room = ROOMS.get(game)!(code);
	const actorId = await room.resolve();
	const { token } = await room.issueToken({
		subject: 'browser',
		expiresIn: TOKEN_SECONDS,
		permissions: { actor_gateway: ['create', 'read'] }
	});
	return { actorId, token };
}

export const listRooms = (game: string): Promise<RoomSummary[]> => admin.roomList.getOrCreate([game]).list();
