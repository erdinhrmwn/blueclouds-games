// What browsers and the backoffice see of a room actor: its views, actions and events.
// Owned by the game server (apps/server), which builds its views from these types.
// Only add to it: rooms still running the previous deploy keep sending the old shape for a while.

import type { Avatar } from '../avatars'

/** Every game has a table of 6 fixed chairs around the dealer. */
export const SEATS = 6

/** Each game's room actor in the registry, by game slug. */
export const ROOM_ACTORS = {
  'bust-31': 'bust31Room',
  cloudburst: 'cloudburstRoom',
} as const

export type GameSlug = keyof typeof ROOM_ACTORS

export const isGameSlug = (slug: string): slug is GameSlug => Object.hasOwn(ROOM_ACTORS, slug)

/** The actor that holds a game's list of open tables (one per list key, see `tournamentListKey`). */
export const ROOM_LIST_ACTOR = 'roomList'

/**
 * Tournament tables report to their own list per game, read only by the backoffice: the public list (keyed by the
 * bare slug) never shows them.
 */
export const tournamentListKey = (slug: string) => `${slug}:tournament`

/** The code a room refuses or closes a connection with once an admin terminated the table or kicked this player. */
export const TABLE_CLOSED = 'table_closed'

export type Phase = 'lobby' | 'playing' | 'finished'

export type TournamentFormat = 'arena' | 'knockout' | 'swiss'

/** Time left on the running turn, relative so a wrong device clock still counts down correctly. */
export interface TurnClock {
  left: number
  total: number
}

/** What every game shows about a player in a chair. Games add their own fields. */
export interface SeatedPlayer {
  id: string
  name: string
  bot: boolean
  seat: number
  away: boolean
  vip: boolean
  avatar: Avatar
}

/** Set at a tournament table: it starts by itself. Times are ms from when the view was sent. */
export interface TournamentView {
  /** Present from rooms made after tournament rounds; older ones leave it out. */
  id?: string
  name: string
  /** Null or missing from older rooms. */
  format?: TournamentFormat | null
  /** Arena and Swiss: how many rounds it plays; null for Knockout, missing from older rooms. */
  rounds?: number | null
  /** Everyone still signed up to the tournament, all tables; null or missing from older rooms. */
  registered?: number | null
  /** The tournament round this table plays in. */
  round?: number
  startsIn: number
  waitEndsIn: number
  seats: number
  closed: boolean
}

/**
 * Provably fair rounds: the hash of the round being played (in the lobby: of the next match's first round) and of
 * the round after it, both locked in before they are dealt; while a match is played also its id and the client seed
 * of its last shuffle.
 */
export interface FairnessView {
  matchId: string | null
  /** The last match played at this table, whose rounds the dialog still shows once it ended. */
  lastMatchId: string | null
  round: number
  serverSeedHash: string
  clientSeed: string | null
  nextServerSeedHash: string | null
}

/** What every game's table view has. */
export interface TableView {
  phase: Phase
  hostId: string | null
  players: SeatedPlayer[]
  turnPlayerId: string | null
  turn: TurnClock | null
  /** 0 before the first deal. */
  round: number
}

/** What the room adds to its game's view. */
export interface RoomExtras {
  tournament: TournamentView | null
  /** The table's own name, picked when it was opened; null (or missing from older rooms) for none. */
  roomName?: string | null
  /** Null for a match started before provably fair shuffles. */
  fairness: FairnessView | null
}

/** The view the shared lobby and room frame read, whatever the game. */
export interface BaseView extends TableView, RoomExtras {}

/** Connection params from a browser: a play token from the platform (who you are, and your name). */
export interface PlayerParams {
  playToken: string
}

/** Connection params from the backoffice's server: the engine's admin token, which only servers hold. */
export interface AdminParams {
  adminKey: string
}

export interface JoinResult<View, Hand> {
  playerId: string
  view: View
  hand: Hand
}

/** Every game's room has these actions; games add their own moves. */
export interface RoomActions<View, Hand> {
  /** Joins (or rejoins) the room. Safe to repeat on every reconnect. */
  join(): Promise<JoinResult<View, Hand>>
  leave(): Promise<void>
  start(): Promise<void>
  /** Host only: seats a bot in an empty chair. */
  addBot(seat: number): Promise<void>
  /** Moves you to an empty chair (lobby only). */
  takeSeat(seat: number): Promise<void>
  /** Host only. */
  removeBot(botId: string): Promise<void>
  /** Host only, in the lobby: takes a player off the table for good. */
  kick(seat: number): Promise<void>
  reset(): Promise<void>
}

/** Sent just before the room closes a connection for good. */
export interface ClosedEvent {
  code: typeof TABLE_CLOSED
  message: string
}

/** Events a room sends to its connections. */
export interface RoomEvents<View, Hand> {
  /** To everyone, after every change. */
  view: View
  /** To each player, their own hand. */
  hand: Hand
  closed: ClosedEvent
}

export interface AdminKickInput {
  seat: number
  /** Goes to the audit and match logs. 1 to 200 characters. */
  reason: string
}

export interface AdminTerminateInput {
  reason: string
}

/** Who was kicked, from which phase, and the match it happened in (null when none was running). */
export interface KickResult {
  playerId: string
  name: string
  seat: number
  phase: Phase
  matchId: string | null
}

/** What the table was doing when an admin terminated it. */
export interface TerminateResult {
  phase: Phase
  matchId: string | null
  round: number
  players: number
}

/** Backoffice only (connected with `AdminParams`). */
export interface AdminActions {
  /** Kicks a player off the table, in the lobby or mid-game. */
  adminKick(input: AdminKickInput): Promise<KickResult>
  /** Ends the table for good; a running match is saved as terminated. */
  adminTerminate(input: AdminTerminateInput): Promise<TerminateResult>
}

/** Who sits in one seat, for the backoffice's Live tables. No ids: the list is read by servers only. */
export interface SeatSummary {
  seat: number
  name: string
  bot: boolean
}

/** What a room list shows about one table. */
export interface RoomSummary {
  code: string
  /** The table's own name. */
  name: string | null
  host: string | null
  players: number
  maxPlayers: number
  phase: Phase
  seats: SeatSummary[]
  /** 0 before the first deal. */
  round: number
}

/** The room list actor, as servers read it. */
export interface RoomListActions {
  list(): Promise<RoomSummary[]>
}
