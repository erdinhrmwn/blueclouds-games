// Layer 1, domain: the ports between the room layer and the outside. The room layer only knows these interfaces;
// core/adapters implements them (the platform's HTTP API, the actor's SQLite, the room list actor), and tests
// pass fakes.

import type { RoomSummary, TournamentFormat } from 'contracts/rooms/room'
import type { LogEvent, MatchReport, RoundReport } from './match'
import type { Identity, SavedRoom } from './room'
import type { Table } from './table'

/** How a send to the platform went: stored, never acceptable (dropped), or worth another try later. */
export interface SendResult {
  result: 'sent' | 'rejected' | 'retry'
  detail?: string
}

export interface MarkResult {
  ok: boolean
  detail?: string
}

export type RoomChange = 'start' | 'close'

export type CloseReason = 'not_enough_players' | 'terminated'

/** A tournament as the platform tells a room about it. */
export interface PlatformTournament {
  id: string
  name: string
  format: TournamentFormat | null
  /** Arena and Swiss: how many rounds it plays; null for Knockout or from an older platform. */
  rounds: number | null
  /** Everyone still signed up to the tournament; null from an older platform. */
  registered: number | null
  /** The tournament round this table plays in. */
  round: number
  startsAt: string
  cancelled: boolean
}

export interface PlatformSeat {
  playerId: string
  seat: number | null
  /** A bot account the platform signed up to fill the tables; the room plays its seat. */
  bot: boolean
  name: string
}

/** A room as the platform knows it: who may sit where, and its tournament (null for an open table). */
export interface PlatformRoom {
  visibility: 'public' | 'private'
  /** The table's own name; null when none was picked. */
  name: string | null
  minPlayers: number
  startedAt: string | null
  closedAt: string | null
  tournament: PlatformTournament | null
  seats: PlatformSeat[]
}

/** Everything a room needs from the BlueClouds Platform. */
export interface PlatformPort {
  /** Who a play token belongs to; null when it isn't valid. */
  verifyPlayToken(token: unknown): Promise<Identity | null>
  /** Idempotent by match id. */
  reportMatch(report: MatchReport): Promise<SendResult>
  reportRound(matchId: string, round: RoundReport): Promise<SendResult>
  /** Null when the platform doesn't know the room; throws when it can't be reached. */
  fetchRoomSeats(code: string): Promise<PlatformRoom | null>
  /** Which of these players are VIP right now; throws when the platform can't be reached. */
  fetchVipIds(ids: string[]): Promise<Set<string>>
  /** A tournament room's match began, or the room closed without one. */
  markRoom(code: string, change: RoomChange, reason?: CloseReason): Promise<MarkResult>
}

/** A finished match's result waiting in the outbox. */
export interface QueuedMatch {
  matchId: string
  report: MatchReport
  body: string
  attempts: number
}

/** A closed round waiting in the outbox; a match's rounds go out in order, before its result. */
export interface QueuedRound {
  matchId: string
  round: number
  report: RoundReport
  body: string
  attempts: number
}

/** One commit's writes, all or nothing: the move log never skips or repeats a move. */
export interface RoomTransaction {
  appendEvents(matchId: string, events: LogEvent[]): Promise<void>
  matchLog(matchId: string): Promise<LogEvent[]>
  queueRound(matchId: string, report: RoundReport): Promise<void>
  queueMatch(report: MatchReport): Promise<void>
  clearMatchLog(matchId: string): Promise<void>
  saveRoom(room: SavedRoom<Table>): Promise<void>
}

/** The room's own storage: the saved room, the move log of the running match, and the outbox to the platform. */
export interface RoomStorePort {
  /** The saved room as it was stored (an older save may miss fields); null for a new room. */
  loadRoom(): Promise<unknown>
  transaction(work: (tx: RoomTransaction) => Promise<void>): Promise<void>
  hasQueuedReports(): Promise<boolean>
  queuedRounds(): Promise<QueuedRound[]>
  queuedMatches(): Promise<QueuedMatch[]>
  roundFailed(matchId: string, round: number): Promise<void>
  roundDone(matchId: string, round: number): Promise<void>
  matchFailed(matchId: string): Promise<void>
  matchDone(matchId: string): Promise<void>
}

/** A game's lists of tables (public, and the backoffice's tournament one), keyed by list key. */
export interface RoomListPort {
  report(listKey: string, summary: RoomSummary): Promise<void>
  remove(listKey: string, code: string): Promise<void>
}

/** The outside world, as one room reaches it. */
export interface RoomPorts {
  platform: PlatformPort
  store: RoomStorePort
  lists: RoomListPort
}
