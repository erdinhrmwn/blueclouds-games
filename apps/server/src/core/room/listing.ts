// Layer 3, room: keeps this table's line in its game's room list current.

import type { RoomPorts } from '../domain/ports'
import { directoryKey, roomSummary } from '../rules/listing'
import { type RoomCtx, roomCode } from './context'
import { loadTournament } from './tournament'

/**
 * A table with nobody connected is taken off the list (bots alone don't count). `leaving` is a connection that
 * is closing. The list is a convenience, so a failure is logged and the game carries on.
 */
export async function reportToDirectory(
  c: RoomCtx,
  ports: Pick<RoomPorts, 'platform' | 'lists'>,
  slug: string,
  leaving?: string,
): Promise<void> {
  // Public tables go to the game's list. Tournament tables go to their own list for the backoffice (round and
  // seats). Private tables are for their players only.
  const tournament = await loadTournament(c, ports.platform).catch(() => undefined)
  const listKey = directoryKey(slug, c.vars.listed === true, !!tournament)
  if (!listKey) {
    return
  }

  const code = roomCode(c)

  // Only players count: the backoffice's connection is not someone at the table.
  const stayingConns = [...c.conns.values()].filter(
    (conn) => conn.id !== leaving && c.vars.who[conn.id],
  )

  try {
    if (stayingConns.length === 0 || c.vars.terminated) {
      await ports.lists.remove(listKey, code)
      return
    }

    await ports.lists.report(listKey, roomSummary(code, c.vars.roomName ?? null, c.vars.game))
  } catch (err) {
    c.log.warn({ msg: 'room list update failed', code, err: String(err) })
  }
}
