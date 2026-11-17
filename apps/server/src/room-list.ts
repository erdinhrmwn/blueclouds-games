// The room list actor: one per game (and one per game for tournament tables), keyed by list key. Its own small
// service: it validates what rooms report and keeps it in its SQLite.

import { SEATS } from 'contracts/rooms/room'
import { actor, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import { z } from 'zod'
import type { SqlDatabase } from './core/adapters/room-store'
import { SeatInput } from './core/room/inputs'

/** Rooms nobody has touched for this long are dropped, in case a room never said goodbye. */
const STALE_MS = 2 * 60 * 60 * 1000
const LIST_LIMIT = 50

/** Room codes are the actor key: short, uppercase, easy to read aloud. */
export const RoomCode = z.string().regex(/^[A-Z0-9]{4,8}$/)

/** Who sits in one seat, for the backoffice's Live tables. No ids: the list is read by servers only. */
export const SeatSummary = z.object({
  seat: SeatInput,
  name: z.string().max(20),
  bot: z.boolean(),
})

/** What the room list shows about one table. Sent by room actors to their game's list. */
export const RoomSummary = z.object({
  code: RoomCode,
  /** The table's own name; rooms running older code send none. */
  name: z.string().max(32).nullable().default(null),
  host: z.string().max(20).nullable(),
  players: z.number().int().min(0).max(SEATS),
  maxPlayers: z.number().int().min(1).max(SEATS),
  phase: z.enum(['lobby', 'playing', 'finished']),
  // Rooms running older code don't send seats or the round yet.
  seats: z.array(SeatSummary).max(SEATS).default([]),
  /** 0 before the first deal. */
  round: z.number().int().min(0).max(10_000).default(0),
})
export type RoomSummary = z.infer<typeof RoomSummary>

/**
 * The list of open tables of one game, for its "Open tables" section. One instance per game, keyed by slug.
 * Rooms report themselves whenever they change and remove themselves when nobody is connected.
 * Browsers can't reach it: their engine tokens only reach one room. The game's server reads the list.
 */
export const roomList = actor({
  // Shown in the Rivet dashboard.
  options: { name: 'Room List', icon: 'list' },
  db: db({
    onMigrate: async (database) => {
      await database.execute(`
				CREATE TABLE IF NOT EXISTS rooms (
					code TEXT PRIMARY KEY,
					data TEXT NOT NULL,
					updated_at INTEGER NOT NULL
				)`)
    },
  }),
  actions: {
    list: async (c) => listRooms(c.db),
    report: async (c, input: unknown) => {
      const parsed = RoomSummary.safeParse(input)
      if (!parsed.success) {
        throw new UserError('Invalid room summary.', { code: 'bad_input' })
      }

      await c.db.execute(
        `INSERT INTO rooms (code, data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        parsed.data.code,
        JSON.stringify(parsed.data),
        Date.now(),
      )

      c.broadcast('rooms', await listRooms(c.db))
    },
    remove: async (c, code: unknown) => {
      const parsed = RoomCode.safeParse(code)
      if (!parsed.success) {
        throw new UserError('Invalid room code.', { code: 'bad_input' })
      }

      await c.db.execute(
        `DELETE FROM rooms
        WHERE code = ?`,
        parsed.data,
      )

      c.broadcast('rooms', await listRooms(c.db))
    },
  },
})

interface ListRow extends Record<string, unknown> {
  data: string
}

async function listRooms(database: SqlDatabase): Promise<RoomSummary[]> {
  await database.execute(
    `DELETE FROM rooms
    WHERE updated_at < ?`,
    Date.now() - STALE_MS,
  )

  const rows = await database.execute<ListRow>(
    `SELECT data
    FROM rooms
    ORDER BY updated_at DESC
    LIMIT ?`,
    LIST_LIMIT,
  )

  return rows.map((row) => JSON.parse(row.data) as RoomSummary)
}
