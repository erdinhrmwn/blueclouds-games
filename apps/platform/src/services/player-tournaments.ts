// A player's own tournaments: the tables they sit at now, and every tournament they are or were in.

import type { SQL } from 'bun'
import type { TournamentFormat } from 'contracts/rooms/room'
import { LIST_LIMIT } from './tournament-signups'

/** A tournament table the player sits at. */
export interface SeatedRoom {
  code: string
  game: string
  seat: number | null
  /** Its match began: withdrawing is no longer possible, the player leaves from the table. */
  started: boolean
  tournament: { id: string; name: string; startsAt: string }
}

interface SeatedRoomRow {
  code: string
  game_slug: string
  seat: number | null
  started_at: Date | null
  tournament_id: string
  name: string
  starts_at: Date
}

/** The open tournament tables the player is seated at, so the game's home page can show "your table". */
export async function seatedRooms(
  sql: SQL,
  playerId: string,
  game: string | undefined,
): Promise<SeatedRoom[]> {
  const gameFilter = game ? sql`AND r.game_slug = ${game}` : sql``

  const rows = await sql`
		SELECT r.code, r.game_slug, ra.seat, r.started_at, t.id AS tournament_id, t.name, t.starts_at
		FROM room_assignments ra
		JOIN rooms r ON r.id = ra.room_id
		JOIN tournaments t ON t.id = ra.tournament_id
		JOIN tournament_players tp
			ON tp.tournament_id = ra.tournament_id AND tp.player_id = ra.player_id
		WHERE ra.player_id = ${playerId}
			AND tp.status = 'registered'
			AND r.closed_at IS NULL
			AND t.cancelled_at IS NULL
			${gameFilter}
		ORDER BY t.starts_at
		LIMIT ${LIST_LIMIT}`

  return rows.map((row: SeatedRoomRow) => ({
    code: row.code,
    game: row.game_slug,
    seat: row.seat,
    started: !!row.started_at,
    tournament: {
      id: row.tournament_id,
      name: row.name,
      startsAt: row.starts_at.toISOString(),
    },
  }))
}

/** One tournament the player is or was in, as their profile lists it. */
export interface MyTournament {
  id: string
  game: string
  name: string
  format: TournamentFormat | null
  status: 'upcoming' | 'live' | 'finished' | 'cancelled'
  startsAt: string
  endedAt: string | null
  entry: 'registered' | 'withdrawn' | 'disqualified'
  players: number
  /** Live: the Stage being played. Finished: the last Stage they sat in. */
  stage: number | null
  place: number | null
  /** What their place wins, never whether it was paid out yet. */
  prize: { coins: number; extra: string | null } | null
}

/** The player's record over every tournament they finished. */
export interface TournamentRecord {
  played: number
  podiums: number
  bestPlace: number | null
  prizeCoins: number
}

export interface MyTournaments {
  tournaments: MyTournament[]
  record: TournamentRecord
}

/** How many of the player's tournaments their profile lists; their record counts all of them. */
const MY_TOURNAMENTS_SHOWN = 20

interface MyTournamentRow {
  id: string
  game_slug: string
  name: string
  format: TournamentFormat | null
  starts_at: Date
  ended_at: Date | null
  cancelled: boolean
  distributed: boolean
  entry: 'registered' | 'withdrawn' | 'disqualified'
  players: number
  stage: number | null
  place: number | null
  prize_coins: number | null
  prize_extra: string | null
}

/**
 * The tournaments the player signed up for (a sign-up taken back before the start is gone), newest first, with
 * their place and the prize that place carries, plus their record over all of them. The prize is what the place
 * wins, never whether it was paid out yet: players don't see payout status (Erdin, 2026-11-14).
 */
export async function myTournaments(sql: SQL, playerId: string): Promise<MyTournaments> {
  const rows = await sql`
		SELECT
			t.id,
			t.game_slug,
			t.name,
			t.format,
			t.starts_at,
			t.ended_at,
			t.cancelled_at IS NOT NULL AS cancelled,
			t.distributed_at IS NOT NULL AS distributed,
			tp.status AS entry,
			(
				SELECT count(*)::int
				FROM tournament_players x
				WHERE x.tournament_id = t.id
					AND x.status <> 'withdrawn'
			) AS players,
			coalesce(
				tr.last_round,
				(
					SELECT max(round.round)
					FROM tournament_rounds round
					WHERE round.tournament_id = t.id
				)
			)::int AS stage,
			tr.place,
			prize.coins AS prize_coins,
			prize.extra AS prize_extra
		FROM tournament_players tp
		JOIN tournaments t ON t.id = tp.tournament_id
		LEFT JOIN tournament_results tr
			ON tr.tournament_id = t.id
			AND tr.player_id = tp.player_id
		LEFT JOIN tournament_prizes prize
			ON prize.tournament_id = t.id
			AND prize.place = tr.place
		WHERE tp.player_id = ${playerId}
		ORDER BY t.starts_at DESC, t.id DESC
		LIMIT ${MY_TOURNAMENTS_SHOWN}`

  const [record] = await sql`
		SELECT
			count(*)::int AS played,
			count(*) FILTER (WHERE tr.place <= 3)::int AS podiums,
			min(tr.place)::int AS best_place,
			coalesce(sum(prize.coins), 0)::int AS prize_coins
		FROM tournament_results tr
		LEFT JOIN tournament_prizes prize
			ON prize.tournament_id = tr.tournament_id
			AND prize.place = tr.place
		WHERE tr.player_id = ${playerId}`

  return {
    tournaments: rows.map((row: MyTournamentRow) => ({
      id: row.id,
      game: row.game_slug,
      name: row.name,
      format: row.format,
      status: tournamentStatus(row),
      startsAt: row.starts_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
      entry: row.entry,
      players: row.players,
      stage: row.stage,
      place: row.place,
      prize: row.prize_coins === null ? null : { coins: row.prize_coins, extra: row.prize_extra },
    })),
    record: {
      played: record.played,
      podiums: record.podiums,
      bestPlace: record.best_place,
      prizeCoins: record.prize_coins,
    },
  }
}

function tournamentStatus(row: MyTournamentRow): 'upcoming' | 'live' | 'finished' | 'cancelled' {
  if (row.cancelled) {
    return 'cancelled'
  }

  if (row.ended_at) {
    return 'finished'
  }

  if (row.distributed) {
    return 'live'
  }

  return 'upcoming'
}
