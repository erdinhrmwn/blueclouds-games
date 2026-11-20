import type { Card, Player } from 'contracts/rooms/cloudburst'
import { shake } from '#lib/motion.ts'

/**
 * Round end: each seat's leftover cards fan open face up over it, then drip one by one into its cloud meter,
 * filling a segment as each lands. A seat that reaches the burst limit shakes once. Done well inside
 * DEAL.roundEndMs, before the next deal.
 */
export const REVEAL = {
  fanMs: 250,
  holdMs: 700,
  spreadMs: 1800,
  stepMs: 180,
  fallMs: 380,
  clearMs: 3600,
}
const BURST_SHAKE_MS = 900

/** The round-end reveal of one table: which cards drip into which meter, and how many have landed. */
export class Reveal {
  /** The move whose round end is showing; null when none is. */
  #moves = $state<number | null>(null)
  #left = $state<Record<string, Card[]>>({})
  #landed = $state<Record<string, number>>({})
  /** Seats whose meter just reached the limit and flashes. */
  bursting = $state<string[]>([])

  /** Shows this round end's leftover hands, and clears them after REVEAL.clearMs unless a newer one started. */
  start(moves: number, left: Record<string, Card[]>) {
    this.#moves = moves
    this.#left = left
    this.#landed = {}

    setTimeout(() => {
      if (this.#moves === moves) {
        this.#moves = null
        this.#left = {}
        this.#landed = {}
      }
    }, REVEAL.clearMs)
  }

  /** The cards still showing over a seat, face up. */
  leftOf(playerId: string): Card[] {
    return this.#left[playerId] ?? []
  }

  /** The seat's card count: during the reveal, the cards not yet dripped into its meter. */
  cardsOf(player: Player): number {
    if (this.#moves === null) {
      return player.cards
    }

    return this.leftOf(player.id).length - (this.#landed[player.id] ?? 0)
  }

  /** The points a seat's meter shows: during the reveal, the old total plus the drops landed so far. */
  pointsOf(player: Player): number {
    if (this.#moves === null) {
      return player.points
    }

    return player.points - this.leftOf(player.id).length + (this.#landed[player.id] ?? 0)
  }

  /** One card landed in the seat's meter; the last one shakes the seat if it reached `burstAt`. */
  land(player: Player, burstAt: number) {
    if (this.#moves === null) {
      return
    }

    const landed = (this.#landed[player.id] ?? 0) + 1
    this.#landed[player.id] = landed

    if (landed < this.leftOf(player.id).length || player.points < burstAt) {
      return
    }

    const seat = document.querySelector<HTMLElement>(`[data-seat="${CSS.escape(player.id)}"]`)
    shake(seat ?? undefined)

    this.bursting = [...this.bursting, player.id]
    setTimeout(() => {
      this.bursting = this.bursting.filter((id) => id !== player.id)
    }, BURST_SHAKE_MS)
  }
}
