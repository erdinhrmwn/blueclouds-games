import { isGameSlug, ROOM_ACTORS, ROOM_LIST_ACTOR, type RoomSummary } from 'contracts/rooms/room'
import { createClient } from 'rivetkit/client'
import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private'
import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public'

/** How long a browser's engine token lasts; the Rivet client asks for a new one when it expires. */
const TOKEN_SECONDS = 15 * 60

// The engine as this server reaches it, signed in with the admin token. Not as URL credentials:
// rivetkit also reads RIVET_TOKEN from env and refuses a token given both ways.
// Untyped: web never imports the game server; the room contracts (contracts/rooms) type what it reads.
const admin = createClient({
  endpoint: RIVET_ENDPOINT ?? PUBLIC_RIVET_ENDPOINT,
  namespace: 'default',
  token: RIVET_TOKEN,
  devtools: false,
})

export const hasRooms = isGameSlug

/**
 * Creates the room if needed and returns a token that reaches only that room's actor.
 * Browsers can't reach other rooms, the room list, or anything else in the engine.
 * `game` must pass `hasRooms` first.
 */
export async function issueRoomToken(
  game: string,
  code: string,
): Promise<{ actorId: string; token: string }> {
  if (!isGameSlug(game)) {
    throw new Error(`No rooms for game ${game}`)
  }

  const room = admin.getOrCreate(ROOM_ACTORS[game], [code])
  const actorId = await room.resolve()
  const { token } = await room.issueToken({
    subject: 'browser',
    expiresIn: TOKEN_SECONDS,
    permissions: { actor_gateway: ['create', 'read'] },
  })
  return { actorId, token }
}

/** The room list's `list` action (RoomListActions). */
export const listRooms = (game: string): Promise<RoomSummary[]> =>
  admin.getOrCreate(ROOM_LIST_ACTOR, [game]).action({ name: 'list', args: [] })
