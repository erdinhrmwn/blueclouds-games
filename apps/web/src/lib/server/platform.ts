import { type Cookies, error, json, type RequestEvent } from '@sveltejs/kit'
import type { Avatar } from 'contracts/avatars'
import {
  type ClientRequestOptions,
  type ClientResponse,
  hc,
  type InferResponseType,
} from 'hono/client'
import type { AppType } from 'platform/rpc'
import { dev } from '$app/env'
import { PLATFORM_URL } from '$app/env/private'
import { log } from './log.ts'

/**
 * The game's server side of the platform: the browser calls our /api routes, and this module
 * calls the platform over the internal network. The player secret lives only in an httpOnly cookie.
 */

const SECRET_COOKIE = 'player_secret'
/** 400 days: the longest browsers keep a cookie. */
const SECRET_MAX_AGE = 400 * 24 * 60 * 60
const TIMEOUT_MS = 5_000
const NAME_MAX = 20

/** The platform's API, typed by its routes (AppType): paths, inputs and answers can't drift from it. */
const platform = hc<AppType>(PLATFORM_URL).v1

/** What a route answers on success. Errors are the same envelope for every route (see `call`). */
interface Ok<T> {
  ok: true
  data: T
}
interface Failed {
  ok: false
  error: { code: string; message: string; fields?: Record<string, string> }
}
type Envelope<T> = Ok<T> | Failed
type Answer<T> = ClientResponse<Ok<T>, number, 'json'>

/** The `data` a platform route answers with. */
type Data<Route extends (...args: never[]) => unknown> = InferResponseType<Route>['data']

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

/**
 * Sends one request to the platform: `send` makes it with the options given here (who asks, the timeout).
 * Answers the route's data, or throws a PlatformError with the platform's own code and message.
 */
async function call<T>(
  event: RequestEvent,
  secret: string | undefined,
  send: (options: ClientRequestOptions) => Promise<Answer<T>>,
): Promise<T> {
  const headers: Record<string, string> = {
    // The platform rate-limits guests by IP; it trusts this header because only we can reach it.
    'X-Forwarded-For': event.getClientAddress(),
  }
  if (secret) {
    headers.Authorization = `Bearer ${secret}`
  }

  let res: Answer<T>
  try {
    res = await send({ headers, init: { signal: AbortSignal.timeout(TIMEOUT_MS) } })
  } catch (err) {
    log.error({ msg: 'platform unreachable', err })
    throw new PlatformError(503, 'unavailable', 'The game server is busy. Try again in a moment.')
  }

  const body = await envelopeOf(res)
  if (body?.ok) {
    return body.data
  }

  throw new PlatformError(
    res.status,
    body?.error.code ?? 'internal',
    body?.error.message ?? 'Something went wrong. Try again.',
    body?.error.fields,
  )
}

/** The answer's envelope: a route's types know only its success, but any answer may be an error. */
function envelopeOf<T>(res: Answer<T>): Promise<Envelope<T> | null> {
  return res.json().catch(() => null)
}

/** A path segment, as the platform's routes take it. */
const segment = (value: string) => encodeURIComponent(value)

const secretOf = (cookies: Cookies) => cookies.get(SECRET_COOKIE)

const saveSecret = (cookies: Cookies, secret: string) =>
  cookies.set(SECRET_COOKIE, secret, {
    path: '/',
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: SECRET_MAX_AGE,
  })

/** "Play as guest": a new guest for this browser under the name it picked; the platform makes up the username. */
export async function startGuest(event: RequestEvent, name: string): Promise<Me> {
  const { player, playerSecret } = await call(event, undefined, (options) =>
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

/** A secret the platform no longer knows (e.g. a reset database). */
const lost = (err: unknown) => err instanceof PlatformError && err.code === 'unauthenticated'

/** Every page needs a player (see +layout.server.ts), so a missing one here means the session ended. */
const ended = () =>
  new PlatformError(401, 'unauthenticated', 'Your session ended. Reload the page to continue.')

function secretOrEnded(cookies: Cookies): string {
  const secret = secretOf(cookies)
  if (!secret) {
    throw ended()
  }

  return secret
}

/** Like secretOrEnded, for a visitor who may simply not have chosen a name yet. */
function secretOrNameFirst(cookies: Cookies): string {
  const secret = secretOf(cookies)
  if (!secret) {
    throw new PlatformError(401, 'unauthenticated', 'Choose a name first.')
  }

  return secret
}

/** A player as the platform answers it; the avatar's null parts are not picked yet. */
type Player = Data<typeof platform.players.me.$get>['player']

export interface Me extends Player {
  /** Coin balance; left out where an answer doesn't carry it (sign-in, register). */
  coins?: number
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
    const { player, coins } = await call(event, secret, (options) =>
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
    call(event, secret, (options) => platform.players.register.$post({ json: body }, options))

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
  const res = await call(event, undefined, (options) =>
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
  await call(event, signedIn(event), (options) =>
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
    await call(event, secret, (options) => platform.players.logout.$post({}, options))
  } catch (err) {
    if (!lost(err)) {
      throw err
    }
  }
}

/** Renames an account. The platform refuses a guest: it keeps its generated name until it links an account. */
export async function savePlayerName(event: RequestEvent, name: string): Promise<void> {
  await call(event, secretOrEnded(event.cookies), (options) =>
    platform.players.me.$patch({ json: { name } }, options),
  )
}

/** Sets the player's preset avatar (guests too). Returns it as the platform saved it. */
export async function savePlayerAvatar(event: RequestEvent, avatar: Avatar): Promise<Avatar> {
  const { player } = await call(event, secretOrEnded(event.cookies), (options) =>
    platform.players.me.avatar.$put({ json: avatar }, options),
  )

  return player.avatar
}

/** A fresh play token. */
export async function playToken(event: RequestEvent): Promise<string> {
  const { token } = await call(event, secretOrEnded(event.cookies), (options) =>
    platform['play-tokens'].$post({}, options),
  )

  return token
}

type Room = Data<typeof platform.rooms.$post>['room']

export type Visibility = Room['visibility']

/** Opens a new table: the platform picks the code. Public tables are listed in the lobby; private ones need an invite. */
export async function createRoom(
  event: RequestEvent,
  game: string,
  visibility: Visibility,
  name: string | null = null,
): Promise<Room> {
  const { room } = await call(event, secretOrEnded(event.cookies), (options) =>
    platform.rooms.$post({ json: { game, visibility, name: name ?? undefined } }, options),
  )

  return room
}

/** Which game a table code belongs to, if this player may enter it (else a PlatformError). */
export async function roomGame(event: RequestEvent, code: string): Promise<string> {
  const { room } = await call(event, signedIn(event), (options) =>
    platform.rooms[':code'].$get({ param: { code: segment(code) } }, options),
  )

  return room.game
}

/** The table's invite link token, the same one until it is reset. */
export async function createInvite(event: RequestEvent, code: string): Promise<{ token: string }> {
  const { invite } = await call(event, secretOrEnded(event.cookies), (options) =>
    platform.rooms[':code'].invites.$post({ param: { code: segment(code) } }, options),
  )

  return invite
}

/** Kills the table's invite link; only its opener may. */
export async function resetInviteLink(event: RequestEvent, code: string): Promise<void> {
  await call(event, secretOrEnded(event.cookies), (options) =>
    platform.rooms[':code'].invites.link.$delete({ param: { code: segment(code) } }, options),
  )
}

/** Redeems an invite link token: this player may now enter the table. */
export async function redeemInvite(
  event: RequestEvent,
  invite: string,
): Promise<{ code: string; game: string }> {
  const { room } = await call(event, secretOrEnded(event.cookies), (options) =>
    platform.invites.redeem.$post({ json: { invite } }, options),
  )

  return room
}

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

  const { room } = await call(event, secret, (options) =>
    platform.rooms[':code'].$get({ param: { code: segment(code) } }, options),
  )

  if (room.game !== game) {
    throw new PlatformError(404, 'not_found', 'There is no table with that code.')
  }

  return room
}

type EnterableRoom = Data<(typeof platform.rooms)[':code']['$get']>['room']

type Tournaments = Data<typeof platform.tournaments.$get>

export type Tournament = Tournaments['tournaments'][number]
export type TournamentFormat = NonNullable<Tournament['format']>
export type TournamentPrize = Tournament['prizes'][number]
/** A tournament that is playing, or finished within the last day, as the lobby shows it. */
export type LiveTournament = Tournaments['live'][number]
/** One row of a tournament's standings; the final places once it finished. */
export type Standing = Data<
  (typeof platform.tournaments)[':id']['standings']['$get']
>['standings'][number]
export type TournamentTable = Data<typeof platform.players.me.rooms.$get>['rooms'][number]

/** A game's tournaments open for sign-up, and the tournament tables this player sits at. Empty before they chose a name. */
export async function tournamentsFor(
  event: RequestEvent,
  game: string,
): Promise<{ tournaments: Tournament[]; live: LiveTournament[]; tables: TournamentTable[] }> {
  const secret = secretOf(event.cookies)
  const none = { tournaments: [], live: [], tables: [] }
  if (!secret) {
    return none
  }

  const query = { game }

  try {
    const [{ tournaments, live }, { rooms }] = await Promise.all([
      call(event, secret, (options) => platform.tournaments.$get({ query }, options)),
      call(event, secret, (options) => platform.players.me.rooms.$get({ query }, options)),
    ])

    return { tournaments, live, tables: rooms }
  } catch (err) {
    if (lost(err)) {
      return none
    }

    throw err
  }
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
    const { games } = await call(event, secret, (options) => platform.games.$get({}, options))

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

/** Signs the player up for a tournament. */
export async function joinTournament(event: RequestEvent, id: string): Promise<void> {
  const secret = secretOrNameFirst(event.cookies)

  await call(event, secret, (options) =>
    platform.tournaments[':id'].registration.$post({ param: { id: segment(id) } }, options),
  )
}

/** A tournament's standings: worked out from the matches so far, or its final places once it finished. */
export async function tournamentStandings(event: RequestEvent, id: string): Promise<Standing[]> {
  const secret = secretOrNameFirst(event.cookies)
  const { standings } = await call(event, secret, (options) =>
    platform.tournaments[':id'].standings.$get({ param: { id: segment(id) } }, options),
  )

  return standings
}

/** Signs the player out of a tournament, while sign-up is open. */
export async function leaveTournament(event: RequestEvent, id: string): Promise<void> {
  const secret = secretOrNameFirst(event.cookies)

  await call(event, secret, (options) =>
    platform.tournaments[':id'].registration.$delete({ param: { id: segment(id) } }, options),
  )
}

/** Reads a JSON `{ name }` body, or stops with 400. */
export async function readName(request: Request): Promise<string> {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (name.length < 1 || name.length > NAME_MAX) {
    error(400, `Enter a name of 1-${NAME_MAX} characters.`)
  }

  return name
}

type MatchPage = Data<typeof platform.players.me.matches.$get>

/** One of the player's finished matches, as their history lists it. */
export type MatchSummary = MatchPage['matches'][number]

/** The player's finished matches, newest first, a page at a time; `game` keeps one game. */
export async function myMatches(
  event: RequestEvent,
  cursor: string | null,
  game: string | null = null,
): Promise<MatchPage> {
  const query = { cursor: cursor ?? undefined, game: game ?? undefined }

  return call(event, signedIn(event), (options) =>
    platform.players.me.matches.$get({ query }, options),
  )
}

type MyStats = Data<typeof platform.players.me.stats.$get>

/**
 * The player's record in one game: finished matches played and won, wins in a row (best and still going), their
 * average place, and their rounds. What a round won means is the game's (see the catalog's `roundsWon`); `won` is
 * null for a game the platform can't count rounds for.
 */
export type GameStats = MyStats['games'][number]

/** The signed-in player's record per game, for their profile. */
export async function myStats(event: RequestEvent): Promise<MyStats> {
  return call(event, signedIn(event), (options) => platform.players.me.stats.$get({}, options))
}

/** A match's rounds, running or finished. Matches are public: any player may look. */
export type MatchRounds = Data<(typeof platform.matches)[':id']['rounds']['$get']>

export async function matchRounds(event: RequestEvent, matchId: string): Promise<MatchRounds> {
  return call(event, signedIn(event), (options) =>
    platform.matches[':id'].rounds.$get({ param: { id: segment(matchId) } }, options),
  )
}

type Coins = Data<typeof platform.players.me.coins.$get>

/** What changed a player's coins: a fee, refund, prize, bonus or an admin's change with its note. */
export type CoinChange = Coins['history'][number]

/** The player's coins and their history, newest first, a page at a time: `before` is the last change shown. */
export async function coinsOf(event: RequestEvent, before: string | null = null): Promise<Coins> {
  return call(event, signedIn(event), (options) =>
    platform.players.me.coins.$get({ query: { before: before ?? undefined } }, options),
  )
}

type MyTournaments = Data<typeof platform.players.me.tournaments.$get>

/** One tournament the player is or was in, as their profile lists it. */
export type MyTournament = MyTournaments['tournaments'][number]
export type TournamentRecord = MyTournaments['record']

/** The tournaments the player is or was in, newest first, with their record over all of them. */
export async function myTournaments(event: RequestEvent): Promise<MyTournaments> {
  return call(event, signedIn(event), (options) =>
    platform.players.me.tournaments.$get({}, options),
  )
}

/** The tournament tables the player sits at right now, in any game. */
export async function mySeats(event: RequestEvent): Promise<TournamentTable[]> {
  const { rooms } = await call(event, signedIn(event), (options) =>
    platform.players.me.rooms.$get({ query: {} }, options),
  )

  return rooms
}

/** A tournament's own page: what it is, every round's tables (the bracket), and the standings. */
export type TournamentBoard = Data<(typeof platform.tournaments)[':id']['$get']>
/** One table of a tournament round, its players best finish first; an unplayed seat has no placement. */
export type BoardTable = TournamentBoard['rounds'][number]['tables'][number]

export async function tournamentBoard(event: RequestEvent, id: string): Promise<TournamentBoard> {
  return call(event, signedIn(event), (options) =>
    platform.tournaments[':id'].$get({ param: { id: segment(id) } }, options),
  )
}

/** The player's secret, or a 401 the browser sees like any other platform answer. */
function signedIn(event: RequestEvent): string {
  const secret = secretOf(event.cookies)
  if (!secret) {
    throw new PlatformError(401, 'unauthenticated', 'Sign in as a player first.')
  }

  return secret
}

/** An error answer in the same `{ error: { code, message } }` shape as `failure`. */
export function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status })
}

export const BUSY_MESSAGE = 'The game server is busy. Try again in a moment.'

/** Same `{ error: { code, message } }` shape for every failure the browser sees. */
export function failure(err: unknown) {
  if (!(err instanceof PlatformError)) {
    throw err
  }

  const error = { code: err.code, message: err.message, fields: err.fields }
  return json({ error }, { status: err.status })
}
