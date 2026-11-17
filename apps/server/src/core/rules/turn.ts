// Layer 2, rules: the turn clock. Every player gets the same clock; bots and away players just decide sooner.
// Pure: the room arms what this plans.

import type { TurnTimer } from '../domain/room'

/** A bot gets the same turn clock as a human; it just decides within this range (random). */
export const BOT_THINK_MS = [1500, 4000] as const

export interface TurnOptions {
  /** Changes whenever a new turn starts. */
  key: number
  turnMs: number
  /** Holds the clock for an animation (a deal). */
  pause: number
  /** Re-arms the running turn after a wake. */
  resume: boolean
  /** A float in [0, 1), for a bot's think time. */
  rng: () => number
}

/** Who is on turn, as far as the clock cares. */
export interface OnTurn {
  bot: boolean
  away?: boolean
}

/** The timer to show and when the move for this turn is made if nobody plays first. */
export interface TurnPlan {
  timer: TurnTimer
  delay: number
}

/**
 * The plan for the current turn, or null when the running turn already has one (the same `key`, not resuming).
 * Resuming after a wake keeps the deadline players already saw. A bot plays once it has "decided", which stops its
 * clock early, like a quick human.
 */
export function planTurn(
  timer: TurnTimer | null,
  current: OnTurn,
  options: TurnOptions,
  now: number,
): TurnPlan | null {
  const sameTurn = timer?.moves === options.key
  if (sameTurn && !options.resume) {
    return null
  }

  let next: TurnTimer = {
    moves: options.key,
    endsAt: now + options.pause + options.turnMs,
    total: options.turnMs,
  }
  if (sameTurn && timer) {
    next = { ...timer, total: timer.total ?? options.turnMs }
  }

  const pause = sameTurn ? 0 : options.pause
  const untilTimeout = Math.max(0, next.endsAt - now)
  if (!current.bot && !current.away) {
    return { timer: next, delay: untilTimeout }
  }

  const [minThink, maxThink] = BOT_THINK_MS
  const think = minThink + Math.round(options.rng() * (maxThink - minThink))

  return { timer: next, delay: Math.min(untilTimeout, pause + think) }
}
