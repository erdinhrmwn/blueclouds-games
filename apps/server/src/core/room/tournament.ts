// Layer 3, room: a tournament table runs itself. It asks the platform who sits where, starts on time with whoever
// came (bot accounts always come), and closes when too few did.

import { UserError } from 'rivetkit'
import { type PlayerId, toPlayerId } from '../domain/ids'
import type { MatchState } from '../domain/match'
import type { PlatformPort } from '../domain/ports'
import type { Identity, TournamentRoom } from '../domain/room'
import type { GameTable } from '../domain/table'
import { removePlayer } from '../rules/table'
import { LATE_GRACE_MS, roomFacts } from '../rules/tournament'
import { type RoomCtx, roomCode } from './context'

/** How a tournament table starts itself, as its host would at an open table. */
export interface TournamentSteps {
  start(): void
  commit(): Promise<void>
  /** Sits a bot account at its seat; the room then plays it like any bot. */
  seatBot(id: PlayerId, name: string, seat: number | null): void
}

/** The room's tournament and whether it is listed: the known answer, else asked from the platform. */
export async function loadTournament(
  c: RoomCtx,
  platform: PlatformPort,
): Promise<TournamentRoom | null> {
  const known = c.vars.tournament

  // `listed` is undefined in rooms saved before private tables existed: ask once more.
  if (known !== undefined && c.vars.listed !== undefined) {
    return known
  }

  return refreshTournament(c, platform)
}

/**
 * Asks the platform again for the room's tournament and whether it is listed (on every wake, to see a cancel).
 * If the platform can't be reached, the last known answer stands; with none yet, joining is refused.
 */
export async function refreshTournament(
  c: RoomCtx,
  platform: PlatformPort,
): Promise<TournamentRoom | null> {
  const known = c.vars.tournament
  const code = roomCode(c)

  let room: Awaited<ReturnType<PlatformPort['fetchRoomSeats']>>
  try {
    room = await platform.fetchRoomSeats(code)
  } catch (err) {
    c.log.warn({ msg: 'room seats unavailable', code, err: String(err) })
    if (known !== undefined) {
      return known
    }

    throw new UserError("The table can't be reached right now. Try again shortly.", {
      code: 'unavailable',
    })
  }

  const facts = roomFacts(room, known)
  c.vars.listed = facts.listed
  c.vars.roomName = facts.roomName
  c.vars.tournament = facts.tournament

  return facts.tournament
}

/** onWake: refreshes the tournament and arms its start and the end of the wait for late players. */
export async function wakeTournament(c: RoomCtx, platform: PlatformPort): Promise<void> {
  const tournament = await refreshTournament(c, platform).catch(() => null)
  if (!tournament || tournament.closed || tournament.cancelled) {
    return
  }

  if (c.vars.game.phase !== 'lobby') {
    return
  }

  const now = Date.now()
  if (tournament.startsAt > now) {
    await c.schedule.at(tournament.startsAt, 'tournamentStart')
  }

  const waitEndsAt = Math.max(now, tournament.startsAt + LATE_GRACE_MS)
  await c.schedule.at(waitEndsAt, 'tournamentStart')
}

/**
 * The seat a joining player must take (undefined = any free one). Throws if they may not sit here.
 * Asks the platform again first, since an admin may have seated or removed someone by hand.
 */
export async function seatFor(
  c: RoomCtx,
  who: Identity,
  platform: PlatformPort,
): Promise<number | undefined> {
  const tournament = c.vars.tournament === null ? null : await refreshTournament(c, platform)
  if (!tournament) {
    return undefined
  }

  if (tournament.cancelled) {
    throw new UserError(`${tournament.name} was cancelled.`, { code: 'forbidden' })
  }

  if (tournament.closed) {
    throw new UserError('This table has finished.', { code: 'forbidden' })
  }

  if (!(who.id in tournament.seats)) {
    throw new UserError(`This table is for players of ${tournament.name}.`, { code: 'forbidden' })
  }

  return tournament.seats[who.id] ?? undefined
}

/**
 * Starts a tournament room's match: at the start time once every assigned player sits, otherwise when
 * the wait for late players ends, with whoever came. Fewer than the game's minimum then closes the table.
 * Runs when scheduled and after each join; does nothing before the start time or once the match began.
 */
export async function tournamentTick<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  platform: PlatformPort,
  steps: TournamentSteps,
): Promise<void> {
  const tournament = c.vars.tournament
  const table = c.vars.game
  const now = Date.now()

  if (!tournament || tournament.closed || tournament.cancelled) {
    return
  }

  if (c.vars.terminated) {
    return
  }

  if (table.phase !== 'lobby' || now < tournament.startsAt) {
    return
  }

  // Since they sat down a player may have withdrawn, been disqualified or moved by an admin: ask again, and
  // whoever has no seat here anymore leaves before the match starts.
  const seated = (await refreshTournament(c, platform).catch(() => null)) ?? tournament
  if (seated.cancelled) {
    return
  }

  const unseated = table.players.filter((player) => !player.bot && !(player.id in seated.seats))
  for (const player of unseated) {
    c.vars.game = removePlayer(c.vars.game, player.id)
  }

  // Bot accounts are always on time: they take their seats as soon as the table may start.
  const bots = seated.bots ?? {}
  for (const [id, name] of Object.entries(bots)) {
    const sitting = c.vars.game.players.some((player) => player.id === id)
    if (!sitting) {
      // The platform's id, kept as a record key (which only holds plain strings).
      steps.seatBot(toPlayerId(id), name, seated.seats[id] ?? null)
    }
  }

  const people = Object.keys(seated.seats).filter((id) => !(id in bots)).length
  const present = c.vars.game.players.filter((player) => !player.bot).length
  const everyoneIsHere = present >= people
  const seatedCount = c.vars.game.players.length
  const stillWaiting = now < seated.startsAt + LATE_GRACE_MS
  if (!everyoneIsHere && stillWaiting) {
    if (unseated.length > 0) {
      await steps.commit()
    }

    return
  }

  const code = roomCode(c)

  if (seatedCount >= seated.minPlayers) {
    steps.start()
    await steps.commit()

    const marked = await platform.markRoom(code, 'start')
    if (!marked.ok) {
      c.log.warn({ msg: 'room start not recorded', code, detail: marked.detail })
    }

    return
  }

  c.vars.tournament = { ...seated, closed: true }
  await steps.commit()

  const marked = await platform.markRoom(code, 'close')
  if (!marked.ok) {
    c.log.warn({ msg: 'room close not recorded', code, detail: marked.detail })
  }
}
