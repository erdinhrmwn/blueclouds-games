// Layer 2, rules: the move log and match results every game shares (docs/architecture/match-log.md). Pure.

import type { MatchSeeds } from 'contracts/fairness/fairness'
import type { Phase } from 'contracts/rooms/room'
import type {
  LogEntry,
  LogEvent,
  MatchEnd,
  MatchState,
  MoveBy,
  ReportedSeat,
} from '../domain/match'

/** `auto` is true when the server made the move (a bot, a timeout, or an away player). */
export function moveBy(mover: { bot: boolean; away?: boolean }, auto: boolean): MoveBy {
  if (mover.bot) {
    return 'bot'
  }

  if (!auto) {
    return 'player'
  }

  return mover.away ? 'away' : 'timeout'
}

/**
 * Placements from a best-first order of players: 1, 2, 3, … with no shared place, so a terminated match still has
 * exactly one first place. Players the order leaves out are not expected.
 */
export function placementsInOrder(bestFirst: { id: string }[]): Map<string, number> {
  return new Map(bestFirst.map((player, index) => [player.id, index + 1]))
}

/** Gives new log entries their place and time. The clock may step back, so the elapsed time never goes below 0. */
export function stamp<M extends MatchState>(
  match: M,
  entries: LogEntry[],
  now: number,
): { match: M; events: LogEvent[] } {
  const elapsedMs = Math.max(0, now - Date.parse(match.startedAt))
  const events = entries.map((entry, index) => ({
    seq: match.seq + index,
    t: elapsedMs,
    ...entry,
  }))

  return { match: { ...match, seq: match.seq + entries.length }, events }
}

/**
 * How a seat is reported. A bot a host added at an open table is a bot (`bot-…` id, no account). A bot account
 * the platform signed up for a tournament is a player like anyone: it reports under its own id, so its finish
 * counts in the tournament and its prize can be paid.
 */
export function reportedSeat(player: { id: string; name: string; bot: boolean }): ReportedSeat {
  const tableBot = player.bot && player.id.startsWith('bot-')
  if (tableBot) {
    return { playerId: null, bot: true, botName: player.name }
  }

  return { playerId: player.id, bot: false }
}

/** How the running match ends with this commit: an admin terminated the table, the game finished, or not yet. */
export function matchEnd(terminated: boolean, phase: Phase): MatchEnd | null {
  if (terminated) {
    return 'terminated'
  }

  if (phase === 'finished') {
    return 'finished'
  }

  return null
}

/** A kicked player's chair turns "away" in the game's diff; the "kicked" entry already says so. */
export function withoutKickedAway(extra: LogEntry[], entries: LogEntry[]): LogEntry[] {
  const kickedSeats = extra.filter((entry) => entry.type === 'kicked').map((entry) => entry.seat)

  return entries.filter((entry) => entry.type !== 'away' || !kickedSeats.includes(entry.seat))
}

/** The `reveal` entry of a closed round: its seed, now that nobody is dealt from it again. */
export function revealOf(seeds: MatchSeeds, round: number): LogEntry[] {
  const seed = [seeds.previous, seeds.current].find((held) => held?.round === round)
  if (!seed) {
    return []
  }

  return [{ type: 'reveal', data: { round, serverSeed: seed.serverSeed } }]
}
