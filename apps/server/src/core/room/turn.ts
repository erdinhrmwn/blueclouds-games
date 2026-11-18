// Layer 3, room: arms the turn clock the rules planned, and schedules the move made when nobody plays first.

import type { MatchState } from '../domain/match'
import type { GameTable } from '../domain/table'
import { type OnTurn, planTurn, type TurnOptions } from '../rules/turn'
import type { RoomCtx } from './context'

/**
 * Arms the timer for the current turn and schedules `autoPlay(key)` for it: a short think time for bots
 * and away players, the full `turnMs` for humans. Runs on every commit but only arms once per `key`
 * (a number that changes whenever a new turn starts); `resume` re-arms after a wake.
 * `pause` holds the clock for an animation. No player on turn (lobby, finished): no clock.
 */
export async function armTurn<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  current: OnTurn | undefined,
  options: TurnOptions,
): Promise<void> {
  if (!current) {
    c.vars.timer = null
    return
  }

  const plan = planTurn(c.vars.timer, current, options, Date.now())
  if (!plan) {
    return
  }

  c.vars.timer = plan.timer
  await c.schedule.after(plan.delay, 'autoPlay', options.key)
}
