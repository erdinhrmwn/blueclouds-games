// Cloudburst as clients see it. Owned by the game server (apps/server/src/games/cloudburst).
// Rules and their reasons: docs/games/cloudburst/rules.md.

import { type RoomActions, type RoomExtras, SEATS, type SeatedPlayer, type TableView } from './room'

export const HAND_SIZE = 7
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = SEATS
/** The match ends after the round in which anyone reaches this many points. */
export const BURST_AT = 10
/** Dealing and round-end timing, shared so the server holds the first turn of a round until they end. */
export const DEAL = {
  stepMs: 60,
  flightMs: 400,
  roundEndMs: 4000,
}

export const SUITS = ['sun', 'rain', 'wind', 'storm'] as const
export type Suit = (typeof SUITS)[number]

export const ACTIONS = ['calm', 'swirl', 'gust', 'downpour'] as const
/** Wild cards fit anything and let their player pick the suit to follow. */
export const WILDS = ['rainbow', 'tempest'] as const
export type CardKind = 'number' | (typeof ACTIONS)[number] | (typeof WILDS)[number]

/** `value` is 1–8 for numbers and 0 otherwise; `suit` is null only for a wild card. */
export interface Card {
  id: string
  kind: CardKind
  suit: Suit | null
  value: number
}

export const isWild = (card: Card) => card.suit === null

/** Same suit, a number exactly one up or down, the same action, or any wild card. A same number alone does not fit. */
export function fits(card: Card, top: Card, suit: Suit): boolean {
  if (isWild(card) || card.suit === suit) {
    return true
  }

  if (card.kind === 'number') {
    return top.kind === 'number' && Math.abs(card.value - top.value) === 1
  }

  return card.kind === top.kind
}

/**
 * What happened last, for the table's animations. Never holds a card other players must not see:
 * the hands in `roundEnd.left` are shown on purpose, the round is over and they go back in the deck.
 */
export type GameEvent =
  | { type: 'joined'; playerId: string }
  | { type: 'dealt'; round: number }
  | {
      type: 'played'
      playerId: string
      card: Card
      skipped?: string
      /** Downpour or Tempest: how many cards the skipped player had to draw. */
      forced?: number
      gaveTo?: string
      auto?: boolean
    }
  | { type: 'drew'; playerId: string; got: boolean; auto?: boolean }
  | { type: 'passed'; playerId: string; auto?: boolean }
  | {
      type: 'roundEnd'
      outId: string
      card: Card
      gained: Record<string, number>
      /** The cards each player still held, face up for the round-end reveal. */
      left: Record<string, Card[]>
      tie: boolean
      next: 'round' | 'finished'
    }

export interface Player extends SeatedPlayer {
  /** How many cards they hold. */
  cards: number
  /** Points so far this match: one per card left when someone else went out. Fewest wins. */
  points: number
}

/** What every player may see: hand sizes, never the cards in them, nor the deck order. */
export interface PublicView extends TableView {
  players: Player[]
  deckCount: number
  topCard: Card | null
  /** Up to three cards played before the top one, oldest first. */
  pileUnder: Card[]
  /** The suit to follow: the top card's, or the one its player chose for a Rainbow. */
  suit: Suit
  direction: 1 | -1
  /** The player on turn drew this turn: they may play only the drawn card, or pass. */
  drew: boolean
  burstAt: number
  winnerId: string | null
  lastEvent: GameEvent | null
  /** Counts every change; clients use it to spot a new event. */
  moves: number
}

export interface View extends PublicView, RoomExtras {}

/** Your own hand, plus the card you just drew (the only one you may play now). */
export interface Hand {
  cards: Card[]
  drawnId: string | null
}

export interface PlayInput {
  cardId: string
  /** A wild card: the suit to follow. */
  suit?: Suit
  /** A Gust: the card from your hand that goes to the next player. */
  giveId?: string
}

export interface Actions extends RoomActions<View, Hand> {
  play(input: PlayInput): Promise<void>
  draw(): Promise<void>
  pass(): Promise<void>
}
