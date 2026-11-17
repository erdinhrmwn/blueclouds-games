import type { SQL } from 'bun'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { ok } from '../lib/http'
import { playerAuth } from '../middleware/auth'
import { listGames } from '../services/games'

export function gameRoutes(sql: SQL) {
  return (
    new Hono<AppEnv>()
      /** The catalog, with which games are under maintenance. */
      .get('/games', playerAuth(sql), async (c) => {
        return ok(c, { games: await listGames(sql) })
      })
  )
}
