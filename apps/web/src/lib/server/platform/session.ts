// The player's session with the platform: their secret in an httpOnly cookie, who they are, and their account.

import { type Cookies, error, type RequestEvent } from '@sveltejs/kit'
import type { Avatar } from 'contracts/avatars'
import { z } from 'zod'
import { dev } from '$app/env'
import { readJson } from '../body.ts'
import { type Data, PlatformError, platform, platformClient } from './client.ts'

const SECRET_COOKIE = 'player_secret'

/** 400 days: the longest browsers keep a cookie. */
const SECRET_MAX_AGE = 400 * 24 * 60 * 60

const NAME_MAX = 20

export const secretOf = (cookies: Cookies) => cookies.get(SECRET_COOKIE)

const saveSecret = (cookies: Cookies, secret: string) =>
  cookies.set(SECRET_COOKIE, secret, {
    path: '/',
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: SECRET_MAX_AGE,
  })

/** A secret the platform no longer knows (e.g. a reset database). */
export const lost = (err: unknown) => err instanceof PlatformError && err.code === 'unauthenticated'

/** Every page needs a player (see +layout.server.ts), so a missing one here means the session ended. */
const ended = () =>
  new PlatformError(401, 'unauthenticated', 'Your session ended. Reload the page to continue.')

export function secretOrEnded(cookies: Cookies): string {
  const secret = secretOf(cookies)
  if (!secret) {
    throw ended()
  }

  return secret
}

/** Like secretOrEnded, for a visitor who may simply not have chosen a name yet. */
export function secretOrNameFirst(cookies: Cookies): string {
  const secret = secretOf(cookies)
  if (!secret) {
    throw new PlatformError(401, 'unauthenticated', 'Choose a name first.')
  }

  return secret
}

/** The player's secret, or a 401 the browser sees like any other platform answer. */
export function signedIn(event: RequestEvent): string {
  const secret = secretOf(event.cookies)
  if (!secret) {
    throw new PlatformError(401, 'unauthenticated', 'Sign in as a player first.')
  }

  return secret
}

/** A player as the platform answers it; the avatar's null parts are not picked yet. */
type Player = Data<typeof platform.players.me.$get>['player']

export interface Me extends Player {
  /** Coin balance; left out where an answer doesn't carry it (sign-in, register). */
  coins?: number
}

/** "Play as guest": a new guest for this browser under the name it picked; the platform makes up the username. */
export async function startGuest(event: RequestEvent, name: string): Promise<Me> {
  const { player, playerSecret } = await platformClient.call(event, undefined, (options) =>
    platform.players.guest.$post({ json: { name } }, options),
  )

  saveSecret(event.cookies, playerSecret)

  return {
    id: player.id,
    name: player.name,
    username: player.username,
    guest: player.guest,
    avatar: player.avatar,
    createdAt: player.createdAt,
  }
}

/**
 * Who this browser plays as, asked from the platform on every page load so the page never trusts a stale copy.
 * Null for a new visitor, a secret the platform forgot, or a disabled player.
 */
export async function whoAmI(event: RequestEvent): Promise<Me | null> {
  const secret = secretOf(event.cookies)
  if (!secret) {
    return null
  }

  try {
    const { player, coins } = await platformClient.call(event, secret, (options) =>
      platform.players.me.$get({}, options),
    )
    return {
      id: player.id,
      name: player.name,
      username: player.username,
      guest: player.guest,
      avatar: player.avatar,
      createdAt: player.createdAt,
      coins,
    }
  } catch (err) {
    if (lost(err)) {
      event.cookies.delete(SECRET_COOKIE, { path: '/' })
      return null
    }

    const disabled = err instanceof PlatformError && err.status === 403
    if (disabled) {
      return null
    }

    throw err
  }
}

/**
 * Registers a username and password. A guest in this browser becomes the account (keeping their history);
 * without one, a new player is made. Returns the name and username to show.
 */
export async function register(
  event: RequestEvent,
  body: { name: string; username: string; password: string },
): Promise<Me> {
  const send = (secret?: string) =>
    platformClient.call(event, secret, (options) =>
      platform.players.register.$post({ json: body }, options),
    )

  let res: Awaited<ReturnType<typeof send>>
  try {
    res = await send(secretOf(event.cookies))
  } catch (err) {
    if (!lost(err)) {
      throw err
    }

    // The guest's secret is gone: start a new account instead.
    res = await send()
  }

  if (res.playerSecret) {
    saveSecret(event.cookies, res.playerSecret)
  }

  return res.player
}

/** Signs in: this browser gets its own secret for the account. */
export async function login(
  event: RequestEvent,
  body: { username: string; password: string },
): Promise<Me> {
  const res = await platformClient.call(event, undefined, (options) =>
    platform.players.login.$post({ json: body }, options),
  )
  saveSecret(event.cookies, res.playerSecret)

  return res.player
}

/** Changes an account's password; the platform signs every other device out. */
export async function changePassword(
  event: RequestEvent,
  body: { currentPassword: string; newPassword: string },
): Promise<void> {
  await platformClient.call(event, signedIn(event), (options) =>
    platform.players.me.password.$put({ json: body }, options),
  )
}

/** Signs this browser out. A secret the platform already forgot is fine: the cookie goes either way. */
export async function logout(event: RequestEvent): Promise<void> {
  const secret = secretOf(event.cookies)
  event.cookies.delete(SECRET_COOKIE, { path: '/' })
  if (!secret) {
    return
  }

  try {
    await platformClient.call(event, secret, (options) =>
      platform.players.logout.$post({}, options),
    )
  } catch (err) {
    if (!lost(err)) {
      throw err
    }
  }
}

/** Renames an account. The platform refuses a guest: it keeps its generated name until it links an account. */
export async function savePlayerName(event: RequestEvent, name: string): Promise<void> {
  await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform.players.me.$patch({ json: { name } }, options),
  )
}

/** Sets the player's preset avatar (guests too). Returns it as the platform saved it. */
export async function savePlayerAvatar(event: RequestEvent, avatar: Avatar): Promise<Avatar> {
  const { player } = await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform.players.me.avatar.$put({ json: avatar }, options),
  )

  return player.avatar
}

/** A fresh play token. */
export async function playToken(event: RequestEvent): Promise<string> {
  const { token } = await platformClient.call(event, secretOrEnded(event.cookies), (options) =>
    platform['play-tokens'].$post({}, options),
  )

  return token
}

const NameBody = z.object({ name: z.string().trim().min(1).max(NAME_MAX) })

/** Reads a JSON `{ name }` body, or stops with 400. */
export async function readName(request: Request): Promise<string> {
  const body = await readJson(request, NameBody)
  if (!body) {
    error(400, `Enter a name of 1-${NAME_MAX} characters.`)
  }

  return body.name
}
