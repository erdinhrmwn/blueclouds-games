// Layer 1, domain: the table every game shares. Types only (and the rule error); no logic, no imports outside
// contracts/.

import type { Avatar } from 'contracts/avatars'
import type { Phase } from 'contracts/rooms/room'
import type { PlayerId } from './ids'

/**
 * Shuffles a deck for a round (being dealt or played), which is part of its client seed. Injected: a room
 * shuffles provably fair (rules/fair-rng.ts), tests pass `randomRng` with a fixed number.
 */
export interface Rng {
  shuffle<T extends { id: string }>(items: T[], round: number): T[]
}

/** A rule was broken; the room forwards the message to the player. */
export class RuleError extends Error {}

/** What the shared rules need from a player. Turns go up the seat numbers (clockwise). */
export interface Seated {
  id: PlayerId
  name: string
  bot: boolean
  seat: number
  away?: boolean
  /** A VIP account, as its play token said when it sat down. */
  vip?: boolean
  /** The look picked on the platform, as its play token said when it sat down or last came back. */
  avatar?: Avatar
}

/** What the shared rules need from a game. */
export interface Table<P extends Seated = Seated> {
  phase: Phase
  hostId: PlayerId | null
  players: P[]
  moves: number
}

/** A table in the lobby: nobody has won. */
export interface InLobby {
  phase: 'lobby'
  winnerId: null
}

/** A match being played: nobody has won yet. */
export interface InPlay {
  phase: 'playing'
  winnerId: null
}

/** A match that ended: it always has a winner. */
export interface Finished {
  phase: 'finished'
  winnerId: PlayerId
}

/** What the room needs from every game: the shared table, plus the round being played and whose turn it is. */
export interface GameTable<P extends Seated = Seated> extends Table<P> {
  /** 0 before the first deal. */
  round: number
  /** Index into `players` of the player on turn. */
  turn: number
}
