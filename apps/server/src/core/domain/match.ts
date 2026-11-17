// Layer 1, domain: a match and its move log (docs/architecture/match-log.md), and what the platform is sent when a
// round closes or the match ends. Types only.

import type { MatchSeeds } from 'contracts/fairness/fairness'

/** One step of the move log, before it gets its place (`seq`) and time (`t`, ms since the start). */
export interface LogEntry {
  type: string
  seat?: number
  data?: Record<string, unknown>
}

export interface LogEvent extends LogEntry {
  seq: number
  t: number
}

/**
 * The match in progress: its id, when it started, and how many log events it has so far. `seeds` drive its
 * shuffles (fairness); matches started before provably fair shuffles have none.
 */
export interface MatchState {
  id: string
  startedAt: string
  seq: number
  seeds?: MatchSeeds
}

/** Who made a logged move: the player, a bot, or the server for an away or timed-out human. */
export type MoveBy = 'player' | 'bot' | 'away' | 'timeout'

/** How a match ended: played to the end, or stopped by an admin terminating the table. */
export type MatchEnd = 'finished' | 'terminated'

/** How one seat is reported: a bot a host added has no account; everyone else reports under their own id. */
export interface ReportedSeat {
  playerId: string | null
  bot: boolean
  botName?: string
}

export interface ReportedPlayer extends ReportedSeat {
  seat: number
  placement: number
  score: number
}

/**
 * A finished match, as the platform's POST /v1/matches takes it. `score` is game-defined. A terminated match is
 * placed by the standings when it stopped, and counts no win.
 */
export interface MatchReport {
  matchId: string
  game: string
  roomCode: string
  rulesVersion: number
  startedAt: string
  endedAt: string
  endReason: MatchEnd
  players: ReportedPlayer[]
  log: {
    logVersion: number
    events: LogEvent[]
  }
}

/** The match a closed round belongs to. */
export interface MatchInfo {
  id: string
  game: string
  roomCode: string
  startedAt: string
}

export interface ReportedShuffle {
  nonce: number
  clientSeed: string
  deck: string[]
}

/**
 * A closed round, as the platform's POST /v1/matches/:id/rounds takes it: its result (the game's own summary),
 * every move from its deal on (the move log's own events, `t` counted from the match start) and its fairness.
 */
export interface RoundReport {
  roundId: string
  game: string
  roomCode: string
  round: number
  serverSeedHash: string
  serverSeed: string
  shuffles: ReportedShuffle[]
  result: Record<string, unknown>
  events: LogEvent[]
  startedAt: string
  endedAt: string
}

/** The game's summary of a round, from its events (the deal up to the next deal). */
export type RoundResult = (events: LogEvent[]) => Record<string, unknown>
