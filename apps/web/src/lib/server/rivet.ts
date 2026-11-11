import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';
import type { RoomSummary } from 'server/games/bust-31/schema';

/** How long a browser's engine token lasts; the Rivet client asks for a new one when it expires. */
const TOKEN_SECONDS = 15 * 60;

// The engine as this server reaches it, signed in with the admin token.
const url = new URL(RIVET_ENDPOINT ?? PUBLIC_RIVET_ENDPOINT);
url.username = 'default'; // namespace
url.password = RIVET_TOKEN;
const admin = createClient<typeof registry>({ endpoint: url.toString(), devtools: false });

/**
 * Creates the room if needed and returns a token that reaches only that room's actor.
 * Browsers can't reach other rooms, the room list, or anything else in the engine.
 */
export async function issueRoomToken(code: string): Promise<{ actorId: string; token: string }> {
	const room = admin.bust31Room.getOrCreate([code]);
	const actorId = await room.resolve();
	const { token } = await room.issueToken({
		subject: 'browser',
		expiresIn: TOKEN_SECONDS,
		permissions: { actor_gateway: ['create', 'read'] }
	});
	return { actorId, token };
}

export const listRooms = (): Promise<RoomSummary[]> => admin.bust31Rooms.getOrCreate(['main']).list();
