// Layer 1, domain: what a game gives the room it is played in. Each game implements this with its pure rules
// (games/<slug>/definition.ts); the room layer runs any game through it.

import type { GameSlug, TurnClock } from 'contracts/rooms/room'
import type { LogEntry, LogEvent, MatchEnd, MatchReport, MatchState, RoundResult } from './match'
import type { GameTable, Rng } from './table'

export interface GameDefinition<G extends GameTable, M extends MatchState, Action, View, Hand> {
  slug: GameSlug
  /** Shown in the Rivet dashboard. */
  title: string
  icon: string

  createGame(): G
  /** The fields the game adds to its match record, for a new match. */
  newMatch(): Omit<M, keyof MatchState>
  /** Fills in what a game saved by older code misses; runs on every wake. */
  upgrade?(game: G): G

  addPlayer(game: G, id: string, name: string, bot: boolean, seat?: number): G
  /** `byId` must be the host; null when the room starts a tournament table with no host. */
  startGame(game: G, byId: string | null, rng: Rng): G
  resetToLobby(game: G, byId: string): G
  /** A player's move. Throws RuleError when the rules refuse it. */
  applyAction(game: G, playerId: string, action: Action, rng: Rng): G
  /** The move the server makes for the player on turn (a bot, or a human out of time); null when there is none. */
  autoAction(game: G): Action | null
  /** Marks the last move as made for a human by the server, so the table can say so. */
  markAuto(game: G): G
  /** After an automatic move the same turn may go on (a draw): when to move again, or null. */
  followUpMs?(action: Action): number | null

  /** How long a human has to move. */
  turnMs: number
  /** Changes whenever a new turn starts: keys the turn timer. */
  turnKey(game: G): number
  /** How long the clock of a new turn waits for an animation (a deal). */
  dealPauseMs(game: G): number

  publicView(game: G, clock: TurnClock | null): View
  handOf(game: G, playerId: string): Hand

  /** What changed between two states, for the move log. */
  logEvents(before: G, after: G, auto: boolean): LogEntry[]
  /** Updates the match record after each move (e.g. who was knocked out). */
  noteMove?(match: M, game: G): M
  /** The game's summary of a closed round, for the round history. */
  roundResult: RoundResult
  buildReport(
    match: M,
    game: G,
    roomCode: string,
    endedAt: string,
    log: LogEvent[],
    end: MatchEnd,
  ): MatchReport
}
