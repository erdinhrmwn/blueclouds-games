// Layer 1, domain: what a room actor knows and saves, whatever its game. Types only.

import type { Avatar } from 'contracts/avatars'
import type { RoundSeed } from 'contracts/fairness/fairness'
import type { TournamentFormat } from 'contracts/rooms/room'
import type { MatchId, PlayerId } from './ids'
import type { LogEntry, MatchState } from './match'
import type { Table } from './table'

/** Who a connection is, from its play token. */
export interface Identity {
  id: PlayerId
  name: string
  vip: boolean
  avatar: Avatar
}

/** The turn the timer belongs to (`moves` = the turn key), when it runs out (epoch ms), and its full length. */
export interface TurnTimer {
  moves: number
  endsAt: number
  total: number
}

/** The running turn: whose it is and its key, for scheduling a move made for them. */
export interface CurrentTurn {
  playerId: PlayerId | null
  key: number
}

/** A tournament room as the actor knows it from the platform. `seats` maps each assigned player to their seat (null = any). */
export interface TournamentRoom {
  id: string
  name: string
  format: TournamentFormat | null
  /** Arena and Swiss: how many rounds it plays; null for Knockout. */
  rounds: number | null
  /** Everyone still signed up to the tournament, all tables; null from an older platform. */
  registered: number | null
  /** The tournament round this table plays in. */
  round: number
  startsAt: number
  cancelled: boolean
  minPlayers: number
  seats: Record<string, number | null>
  /** Bot accounts among the seats, by id, with the name they play under; the room plays their seats. */
  bots?: Record<string, string>
  closed: boolean
}

/** An admin terminated the table: nobody plays or joins here again. */
export interface Termination {
  at: number
  reason: string
}

/** The next match, fixed before anyone sits down for it: its id and the commitment of its first round. */
export interface NextMatch {
  matchId: MatchId
  firstRound: RoundSeed
}

/**
 * What a room saves: the game, its turn timer, the match being played (null in the lobby), its
 * tournament (null = an open room, undefined = not asked yet), whether it is in the room list (public),
 * the players kicked off it (they can't come back), whether an admin terminated it, the seeds the
 * next match is committed to, and the last match played. Optional fields are missing from rooms saved by
 * older code.
 */
export interface SavedRoom<G extends Table, M extends MatchState = MatchState> {
  game: G
  timer: TurnTimer | null
  match: M | null
  tournament?: TournamentRoom | null
  listed?: boolean
  kicked?: PlayerId[]
  terminated?: Termination | null
  next?: NextMatch
  /** The last match played here, so the table can still show its rounds once it ended. */
  lastMatchId?: MatchId | null
  /** The table's own name, from the platform (null: none was picked). */
  roomName?: string | null
}

/**
 * What every room keeps in `c.vars`: the saved room, with every field an older save may miss filled in, plus what
 * is not saved: who each open connection is (connections close when the actor sleeps), the game as last
 * committed, to see what each commit changed for the move log, when the running VIP check is due (null = none
 * running), and the fairness entries (start, shuffles) waiting for the next commit to log them.
 */
export interface RoomVars<G extends Table, M extends MatchState = MatchState> extends SavedRoom<
  G,
  M
> {
  kicked: PlayerId[]
  terminated: Termination | null
  next: NextMatch
  who: Record<string, Identity>
  logged: G
  vipCheckAt: number | null
  fairLog: LogEntry[]
}
