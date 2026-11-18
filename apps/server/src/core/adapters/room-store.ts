// Layer 4, adapter: the room's own SQLite (the actor's `c.db`), behind RoomStorePort. One JSON row for the whole
// room (a few KB), the move log of the running match, and the outbox of rounds and results for the platform.

import { toMatchId } from '../domain/ids'
import type { LogEvent, MatchReport, RoundReport } from '../domain/match'
import type { QueuedMatch, QueuedRound, RoomStorePort, RoomTransaction } from '../domain/ports'

/** The part of rivetkit's SQLite client used here; tests pass bun:sqlite in memory. */
export interface SqlDatabase {
  execute<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    ...args: unknown[]
  ): Promise<Row[]>
  transaction<T>(work: (tx: SqlDatabase) => Promise<T>, options?: { name?: string }): Promise<T>
}

interface DataRow extends Record<string, unknown> {
  data: string
}

interface BodyRow extends Record<string, unknown> {
  body: string
}

interface CountRow extends Record<string, unknown> {
  n: number
}

interface MatchRow extends Record<string, unknown> {
  match_id: string
  body: string
  attempts: number
}

interface RoundRow extends MatchRow {
  round: number
}

/** The room's tables. Runs as the actor's `db({ onMigrate })`. */
export async function migrateRoom(database: Pick<SqlDatabase, 'execute'>): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS room (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )`)

  // Outbox: finished match results waiting to reach the platform.
  await database.execute(`
    CREATE TABLE IF NOT EXISTS match_reports (
      match_id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    )`)

  // Outbox: closed rounds waiting to reach the platform, sent before their match's report.
  await database.execute(`
    CREATE TABLE IF NOT EXISTS round_reports (
      match_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      body TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (match_id, round)
    )`)

  // Move log of the match being played; moved into its report when the match ends.
  await database.execute(`
    CREATE TABLE IF NOT EXISTS match_events (
      match_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (match_id, seq)
    )`)
}

/** RoomStorePort on the actor's SQLite. */
export function sqliteRoomStore(database: SqlDatabase): RoomStorePort {
  return {
    loadRoom: async () => {
      const [row] = await database.execute<DataRow>(
        `SELECT data
        FROM room
        WHERE id = 1`,
      )
      if (!row) {
        return null
      }

      return JSON.parse(row.data)
    },

    transaction: async (work) => {
      await database.transaction(async (tx) => work(transactionOn(tx)), { name: 'commit' })
    },

    hasQueuedReports: async () => {
      const [matches] = await database.execute<CountRow>(
        `SELECT count(*) AS n
        FROM match_reports`,
      )
      const [rounds] = await database.execute<CountRow>(
        `SELECT count(*) AS n
        FROM round_reports`,
      )

      return Boolean(matches?.n || rounds?.n)
    },

    queuedRounds: async () => {
      const rows = await database.execute<RoundRow>(
        `SELECT match_id, round, body, attempts
        FROM round_reports
        ORDER BY match_id, round`,
      )

      return rows.map((row): QueuedRound => ({
        matchId: toMatchId(row.match_id),
        round: row.round,
        report: JSON.parse(row.body) as RoundReport,
        body: row.body,
        attempts: row.attempts,
      }))
    },

    queuedMatches: async () => {
      const rows = await database.execute<MatchRow>(
        `SELECT match_id, body, attempts
        FROM match_reports`,
      )

      return rows.map((row): QueuedMatch => ({
        matchId: toMatchId(row.match_id),
        report: JSON.parse(row.body) as MatchReport,
        body: row.body,
        attempts: row.attempts,
      }))
    },

    roundFailed: async (matchId, round) => {
      await database.execute(
        `UPDATE round_reports
        SET attempts = attempts + 1
        WHERE match_id = ?
          AND round = ?`,
        matchId,
        round,
      )
    },

    roundDone: async (matchId, round) => {
      await database.execute(
        `DELETE FROM round_reports
        WHERE match_id = ?
          AND round = ?`,
        matchId,
        round,
      )
    },

    matchFailed: async (matchId) => {
      await database.execute(
        `UPDATE match_reports
        SET attempts = attempts + 1
        WHERE match_id = ?`,
        matchId,
      )
    },

    matchDone: async (matchId) => {
      await database.execute(
        `DELETE FROM match_reports
        WHERE match_id = ?`,
        matchId,
      )
    },
  }
}

function transactionOn(tx: SqlDatabase): RoomTransaction {
  return {
    appendEvents: async (matchId, events) => {
      for (const event of events) {
        await tx.execute(
          `INSERT INTO match_events (match_id, seq, body)
          VALUES (?, ?, ?)`,
          matchId,
          event.seq,
          JSON.stringify(event),
        )
      }
    },

    matchLog: async (matchId) => {
      const rows = await tx.execute<BodyRow>(
        `SELECT body
        FROM match_events
        WHERE match_id = ?
        ORDER BY seq`,
        matchId,
      )

      return rows.map((row) => JSON.parse(row.body) as LogEvent)
    },

    queueRound: async (matchId, report) => {
      await tx.execute(
        `INSERT OR IGNORE INTO round_reports (match_id, round, body)
        VALUES (?, ?, ?)`,
        matchId,
        report.round,
        JSON.stringify(report),
      )
    },

    queueMatch: async (report) => {
      await tx.execute(
        `INSERT OR IGNORE INTO match_reports (match_id, body)
        VALUES (?, ?)`,
        report.matchId,
        JSON.stringify(report),
      )
    },

    clearMatchLog: async (matchId) => {
      await tx.execute(
        `DELETE FROM match_events
        WHERE match_id = ?`,
        matchId,
      )
    },

    saveRoom: async (room) => {
      await tx.execute(
        `INSERT INTO room (id, data)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        JSON.stringify(room),
      )
    },
  }
}
