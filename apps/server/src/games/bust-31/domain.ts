// Bust 31, layer 1 (domain): the game's own state as the server keeps it (hands and deck included), its match
// record and the moves a player can make. What clients see lives in contracts/rooms/bust-31.

import type { Avatar } from 'contracts/avatars'
import type { Card, GameEvent } from 'contracts/rooms/bust-31'
import type { MatchState as SharedMatch } from '../../core/domain/match'
import type { Finished, InLobby, InPlay } from '../../core/domain/table'

export interface Player {
  id: string
  name: string
  lives: number
  hand: Card[]
  bot: boolean
  /** Fixed chair at the table, 0 to MAX_PLAYERS - 1. Turns go up the seat numbers (clockwise). */
  seat: number
  /** A human who closed the game mid-match: their turns are played for them until they return. */
  away?: boolean
  vip?: boolean
  avatar?: Avatar
}

/** What a game holds in every phase. */
interface GameState {
  hostId: string | null
  players: Player[]
  deck: Card[]
  discard: Card[]
  total: number
  /** Index into `players` of the player on turn. */
  turn: number
  direction: 1 | -1
  /** Cards the player on turn still has to play this turn: 2 after a Double, otherwise 1. */
  playsLeft: number
  round: number
  lastEvent: GameEvent | null
  /** Counts every deal and play, never resets: identifies a game position for timers. */
  moves: number
}

export interface LobbyGame extends GameState, InLobby {}
export interface PlayingGame extends GameState, InPlay {}
export interface FinishedGame extends GameState, Finished {}

/** The game in one of its phases: only a finished game has a winner. */
export type Game = LobbyGame | PlayingGame | FinishedGame

/** The match in progress. `out` lists player ids in the order they were eliminated. */
export interface MatchState extends SharedMatch {
  out: string[]
}

/** Plays a card from your hand. */
export interface PlayAction {
  type: 'play'
  cardId: string
}

/** A move a player can make. */
export type Action = PlayAction
