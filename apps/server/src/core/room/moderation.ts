// Layer 3, room: players leaving for good. A closed tab that doesn't come back, a host or admin kicking someone,
// and an admin terminating the table.

import { type KickResult, TABLE_CLOSED, type TerminateResult } from 'contracts/rooms/room'
import { UserError } from 'rivetkit'
import type { PlayerId } from '../domain/ids'
import type { LogEntry, MatchState } from '../domain/match'
import type { PlatformPort } from '../domain/ports'
import type { CurrentTurn, Termination } from '../domain/room'
import type { GameTable } from '../domain/table'
import { kickPlayer, markAway, removePlayer } from '../rules/table'
import { BOT_THINK_MS } from '../rules/turn'
import { KICKED_MESSAGE, playerOf, TERMINATED_MESSAGE } from './access'
import { type RoomConn, type RoomCtx, roomCode } from './context'

/** Who asked for a kick: an admin (with a reason for the logs) or the table's host. */
export type KickedBy = { kind: 'admin'; reason: string } | { kind: 'host'; hostId: PlayerId }

/** What a kick or termination did, and what the commit after it logs. */
export interface Outcome<Result> {
  result: Result
  entries: LogEntry[]
}

/** A kick: its outcome, and who was kicked (the result reports them as a plain string). */
export interface Kick extends Outcome<KickResult> {
  playerId: PlayerId
}

/**
 * For the scheduled `dropIfGone`: a player's last connection closed a while ago and none came back.
 * In the lobby they leave the table; mid-game their seat stays and is played for them at bot speed.
 * Returns false when nothing changed (they came back, or are gone already).
 */
export async function dropIfGone<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  id: unknown,
  turn: CurrentTurn,
): Promise<boolean> {
  const game = c.vars.game
  const player = game.players.find((seated) => seated.id === id)
  if (!player) {
    return false
  }

  const cameBack = [...c.conns.values()].some((conn) => playerOf(c, conn) === id)
  if (cameBack) {
    return false
  }

  if (game.phase === 'lobby') {
    c.vars.game = removePlayer(game, player.id)
    return true
  }

  c.vars.game = markAway(game, player.id)

  // Their turn may be running on the full human clock: play it at bot speed instead.
  if (game.phase === 'playing' && turn.playerId === player.id) {
    await c.schedule.after(BOT_THINK_MS[0], 'autoPlay', turn.key)
  }

  return true
}

/**
 * Kicks the human in `seat` off the table and keeps them off it (see kickPlayer for what happens to the chair).
 * The host may only kick before the game starts, and not themselves. The caller commits with `entries`, which
 * log the kick when a match is running, then calls `closeKicked`.
 */
export function kickFromTable<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  seat: number,
  by: KickedBy,
): Kick {
  if (c.vars.terminated) {
    throw new UserError('This table is already closed.', { code: TABLE_CLOSED })
  }

  const game = c.vars.game
  const target = game.players.find((player) => player.seat === seat)
  if (!target) {
    throw new UserError('Nobody sits in that seat.', { code: 'rule' })
  }

  if (target.bot) {
    throw new UserError('That is a bot. Remove it instead.', { code: 'rule' })
  }

  if (by.kind === 'host') {
    if (game.phase !== 'lobby') {
      throw new UserError('Players can only be removed before the game starts.', { code: 'rule' })
    }

    if (target.id === by.hostId) {
      throw new UserError('Use Leave table to leave.', { code: 'rule' })
    }
  }

  c.vars.kicked = [...c.vars.kicked, target.id]
  c.vars.game = kickPlayer(game, target.id)

  const data: Record<string, unknown> = { by: by.kind }
  if (by.kind === 'admin') {
    data.reason = by.reason
  }

  const result: KickResult = {
    playerId: target.id,
    name: target.name,
    seat: target.seat,
    phase: game.phase,
    matchId: c.vars.match?.id ?? null,
  }

  return { result, entries: [{ type: 'kicked', seat: target.seat, data }], playerId: target.id }
}

/**
 * After a kick is committed: their turn, if it is running, is played at bot speed, and their connections close
 * with the reason. `turn` is the running turn, as for dropIfGone.
 */
export async function closeKicked(
  c: RoomCtx,
  playerId: PlayerId,
  turn: CurrentTurn,
): Promise<void> {
  if (c.vars.game.phase === 'playing' && turn.playerId === playerId) {
    await c.schedule.after(BOT_THINK_MS[0], 'autoPlay', turn.key)
  }

  closeConnections(c, (conn) => c.vars.who[conn.id]?.id === playerId, KICKED_MESSAGE)
}

/**
 * An admin terminates the table: nothing moves there again and nobody can join. A running match ends as
 * terminated, with `entries` as its last log event; the caller commits with them (which queues its report),
 * then calls `closeTerminated`.
 */
export function terminateTable(c: RoomCtx, reason: string): Outcome<TerminateResult> {
  if (c.vars.terminated) {
    throw new UserError('This table is already closed.', { code: TABLE_CLOSED })
  }

  const game = c.vars.game
  const termination: Termination = { at: Date.now(), reason }
  c.vars.terminated = termination

  const result: TerminateResult = {
    phase: game.phase,
    matchId: c.vars.match?.id ?? null,
    // A room saved by older code may have no round yet.
    round: game.round ?? 0,
    players: game.players.length,
  }

  return { result, entries: [{ type: 'terminated', data: { by: 'admin', reason } }] }
}

/**
 * After a termination is committed: every player's connection closes with the reason, and a tournament table
 * that had no match running is closed on the platform (a running match's report closes it instead).
 */
export async function closeTerminated(
  c: RoomCtx,
  result: TerminateResult,
  platform: PlatformPort,
): Promise<void> {
  closeConnections(c, (conn) => !!c.vars.who[conn.id], TERMINATED_MESSAGE)

  const tournament = c.vars.tournament
  if (!tournament || tournament.closed || result.matchId) {
    return
  }

  c.vars.tournament = { ...tournament, closed: true }

  const code = roomCode(c)
  const marked = await platform.markRoom(code, 'close', 'terminated')
  if (!marked.ok) {
    c.log.warn({ msg: 'room termination not recorded', code, detail: marked.detail })
  }
}

/** Tells each chosen connection why, then closes it. The browser stops reconnecting on TABLE_CLOSED. */
function closeConnections(c: RoomCtx, chosen: (conn: RoomConn) => boolean, message: string): void {
  for (const conn of c.conns.values()) {
    if (!chosen(conn)) {
      continue
    }

    conn.send('closed', { code: TABLE_CLOSED, message })
    // "<group>.<code>", the shape the Rivet client reads a close reason in.
    conn.disconnect(`user.${TABLE_CLOSED}`)
  }
}
