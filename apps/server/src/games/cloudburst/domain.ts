// Cloudburst, layer 1 (domain): the game's own state as the server keeps it (hands and deck included), its match
// record and the moves a player can make. What clients see lives in contracts/rooms/cloudburst.

import type { Avatar } from 'contracts/avatars'
import type { Card, GameEvent, PlayInput, Suit } from 'contracts/rooms/cloudburst'
import type { MatchState as SharedMatch } from '../../core/domain/match'
import type { Finished, InLobby, InPlay } from '../../core/domain/table'

export interface Player {
  id: string
  name: string
  bot: boolean
  /** Fixed chair at the table, 0 to SEATS - 1. Turns go up the seat numbers (clockwise). */
  seat: number
  away?: boolean
  vip?: boolean
  avatar?: Avatar
  hand: Card[]
  /** Points so far this match: one per card left when someone else went out. Fewest wins. */
  points: number
}

/** What a game holds in every phase. */
interface GameState {
  hostId: string | null
  players: Player[]
  deck: Card[]
  discard: Card[]
  /** The suit to follow: the top card's, or the one its player chose for a Rainbow. */
  suit: Suit
  /** Index into `players` of the player on turn. */
  turn: number
  direction: 1 | -1
  round: number
  /** The current player drew this turn: they may play only that card (`drawnId`), or pass. */
  drew: boolean
  drawnId: string | null
  lastEvent: GameEvent | null
  /** Counts every change; clients use it to spot a new event. */
  moves: number
  /** Changes whenever a new turn starts (not on a draw): keys the turn timer. */
  turnKey: number
}

export interface LobbyGame extends GameState, InLobby {}
export interface PlayingGame extends GameState, InPlay {}
export interface FinishedGame extends GameState, Finished {}

/** The game in one of its phases: only a finished game has a winner. */
export type Game = LobbyGame | PlayingGame | FinishedGame

/** Cloudburst keeps nothing of its own in the match record. */
export type MatchState = SharedMatch

/** Plays a card: `suit` for a wild card, `giveId` (the card to hand on) for a Gust. */
export interface PlayAction {
  type: 'play'
  input: PlayInput
}

/** Draws one card; the turn goes on (play that card, or pass). */
export interface DrawAction {
  type: 'draw'
}

/** Ends the turn after a draw. */
export interface PassAction {
  type: 'pass'
}

/** A move a player can make. */
export type Action = PlayAction | DrawAction | PassAction
