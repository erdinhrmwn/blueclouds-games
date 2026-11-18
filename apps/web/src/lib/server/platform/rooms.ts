// Tables: opening one, entering one by its code or an invite, and which games take new tables.

import type { RequestEvent } from '@sveltejs/kit'
import { type Data, PlatformError, platform, platformClient, segment } from './client.ts'
import { lost, secretOf, secretOrEnded, secretOrNameFirst, signedIn } from './session.ts'

type Room = Data<typeof platform.rooms.$post>['room']

export type Visibility = Room['visibility']

/** Opens a new table: the platform picks the code. Public tables are listed in the lobby; private ones need an invite. */
export async function createRoom(
  event: RequestEvent,
  game: string,
  visibility: Visibility,
  name: string | null = null,
): Promise<Room> {
  const { room } = await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform.rooms.$post({ json: { game, visibility, name: name ?? undefined } }, options),
  )

  return room
}

/** Which game a table code belongs to, if this player may enter it (else a PlatformError). */
export async function roomGame(event: RequestEvent, code: string): Promise<string> {
  const { room } = await platformClient.call(event, signedIn(event), (options) =>
    platform.rooms[':code'].$get({ param: { code: segment(code) } }, options),
  )

  return room.game
}

/** The table's invite link token, the same one until it is reset. */
export async function createInvite(event: RequestEvent, code: string): Promise<{ token: string }> {
  const { invite } = await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform.rooms[':code'].invites.$post({ param: { code: segment(code) } }, options),
  )

  return invite
}

/** Kills the table's invite link; only its opener may. */
export async function resetInviteLink(event: RequestEvent, code: string): Promise<void> {
  await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform.rooms[':code'].invites.link.$delete({ param: { code: segment(code) } }, options),
  )
}

/** Redeems an invite link token: this player may now enter the table. */
export async function redeemInvite(
  event: RequestEvent,
  invite: string,
): Promise<{ code: string; game: string }> {
  const { room } = await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform.invites.redeem.$post({ json: { invite } }, options),
  )

  return room
}

type EnterableRoom = Data<(typeof platform.rooms)[':code']['$get']>['room']

/**
 * The room behind a code, if this player may enter it. Asked before every room token, so a code typed into
 * the URL can't create a room, and a room of another game is not found.
 */
export async function roomFor(
  event: RequestEvent,
  game: string,
  code: string,
): Promise<EnterableRoom> {
  const secret = secretOrNameFirst(event.cookies)

  const { room } = await platformClient.call(event, secret, (options) =>
    platform.rooms[':code'].$get({ param: { code: segment(code) } }, options),
  )

  if (room.game !== game) {
    throw new PlatformError(404, 'not_found', 'There is no table with that code.')
  }

  return room
}

/**
 * The games under maintenance (no new tables), as `{ slug: true }`. Empty when it can't be asked, e.g. before a
 * name.
 */
export async function pausedGames(event: RequestEvent): Promise<Record<string, boolean>> {
  const secret = secretOf(event.cookies)
  if (!secret) {
    return {}
  }

  try {
    const { games } = await platformClient.call(event, secret, (options) =>
      platform.games.$get({}, options),
    )

    const paused: Record<string, boolean> = {}
    for (const entry of games) {
      if (entry.maintenance) {
        paused[entry.slug] = true
      }
    }

    return paused
  } catch (err) {
    if (lost(err)) {
      return {}
    }

    throw err
  }
}

/** Whether a game is under maintenance (no new tables). False when it can't be asked, e.g. before a name. */
export async function underMaintenance(event: RequestEvent, game: string): Promise<boolean> {
  const paused = await pausedGames(event)

  return paused[game] === true
}
