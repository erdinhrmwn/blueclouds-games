// Layer 3, room: VIP tags follow the platform. While anyone is connected the room asks again every so often, so a
// grant or revoke reaches seated players' tags.

import type { MatchState } from '../domain/match'
import type { PlatformPort } from '../domain/ports'
import type { GameTable } from '../domain/table'
import { showVips } from '../rules/table'
import type { RoomCtx } from './context'

/** How often a room with someone connected asks the platform who is VIP. */
export const VIP_REFRESH_MS = 30_000

/**
 * Starts the room's VIP check if none is running. Its due time is not saved: after a wake the next
 * connection starts a fresh check, and the timer left from before the sleep is ignored.
 */
export async function armVipRefresh(c: RoomCtx): Promise<void> {
  if (c.vars.vipCheckAt) {
    return
  }

  const at = Date.now() + VIP_REFRESH_MS
  c.vars.vipCheckAt = at
  await c.schedule.at(at, 'refreshVips', at)
}

/**
 * For the scheduled `refreshVips`: shows a VIP grant or revoke on seated humans' tags, and keeps
 * checking while anyone is connected. Returns true when a tag changed.
 */
export async function refreshVips<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  at: unknown,
  platform: PlatformPort,
): Promise<boolean> {
  // A timer from before a sleep, or a duplicate.
  if (at !== c.vars.vipCheckAt) {
    return false
  }

  c.vars.vipCheckAt = null
  if (c.conns.size > 0) {
    await armVipRefresh(c)
  }

  const humanIds = c.vars.game.players.filter((player) => !player.bot).map((player) => player.id)
  if (humanIds.length === 0) {
    return false
  }

  let vipIds: Set<string>
  try {
    vipIds = await platform.fetchVipIds(humanIds)
  } catch (err) {
    c.log.warn({ msg: 'vip check failed', err: String(err) })
    return false
  }

  // Read the game again: a move may have landed while the platform answered.
  const game = c.vars.game
  const updated = showVips(game, vipIds)
  if (updated === game) {
    return false
  }

  c.vars.game = updated
  return true
}
