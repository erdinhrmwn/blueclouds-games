// Bust 31 as clients see it. Owned by the game server (apps/server/src/games/bust-31).
// Rules and their reasons: docs/games/bust-31/rules.md.

import { type RoomActions, type RoomExtras, SEATS, type SeatedPlayer, type TableView } from './room'

/** The total nobody may go over. */
export const LIMIT = 31
export const HAND_SIZE = 3
export const START_LIVES = 3
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = SEATS
/** Dealing timing, shared so the server holds the first turn of a round until the deal has landed. */
export const DEAL = {
  stepMs: 80,
  flightMs: 400,
  afterBustMs: 1300,
}

export type CardKind = 'number' | 'zero' | 'minus' | 'reverse' | 'swap' | 'ten' | 'double'

export interface Card {
  id: string
  kind: CardKind
  value: number
}

/** What happened last, for the table's animations. */
export type GameEvent =
  | { type: 'joined'; playerId: string }
  | { type: 'started' }
  | {
      type: 'played'
      playerId: string
      card: Card
      total: number
      /** Swap: the player who got the swapper's hand (and gave theirs). */
      swappedWith?: string
      auto?: boolean
    }
  | {
      type: 'bust'
      playerId: string
      card: Card
      total: number
      eliminated: boolean
      auto?: boolean
    }
  | { type: 'finished'; winnerId: string }

export interface Player extends SeatedPlayer {
  lives: number
}

/** What every player may see: no hands, no deck order. */
export interface PublicView extends TableView {
  players: Player[]
  deckCount: number
  topCard: Card | null
  /** Up to three cards played before the top one, oldest first. */
  pileUnder: Card[]
  total: number
  limit: number
  direction: 1 | -1
  /** Cards the player on turn still has to play this turn (2 after a Double). */
  playsLeft: number
  winnerId: string | null
  lastEvent: GameEvent | null
  /** Counts every deal and play, never resets. */
  moves: number
}

export interface View extends PublicView, RoomExtras {}

/** Your own cards. */
export type Hand = Card[]

export interface PlayInput {
  cardId: string
}

export interface Actions extends RoomActions<View, Hand> {
  play(input: PlayInput): Promise<void>
}
