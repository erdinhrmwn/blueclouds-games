// The lobby's open tournaments, and a player signing up for one or leaving it.

import type { SQL } from 'bun'
import type { TournamentFormat } from 'contracts/rooms/room'
import { ApiError } from '../lib/http'
import { moveCoins, refundSignUp } from './coins'

/** The most rows one list answers with. */
export const LIST_LIMIT = 20

/** How many of a tournament's first sign-ups the lobby's Detail names ("Rina, Erdin and 3 more"). */
const PLAYERS_SHOWN = 5

/** A prize for one finishing place; nothing is paid out until an admin does. */
export interface TournamentPrize {
  place: number
  coins: number
  extra: string | null
}

/** A tournament open for sign-up, as the lobby lists it. */
export interface OpenTournament {
  id: string
  name: string
  startsAt: string
  registrationClosesAt: string
  playersPerRoom: number
  /** Fewest players it runs with, else it is cancelled when sign-up closes; null for no minimum. */
  minPlayers: number | null
  /** Most sign-ups, which closes sign-up; null for a tournament that takes anyone. */
  maxPlayers: number | null
  format: TournamentFormat | null
  /** Arena and Swiss: how many rounds it plays; null for a knockout. */
  rounds: number | null
  description: string | null
  /** By finishing place, 1st first. */
  prizes: TournamentPrize[]
  registrationOpensAt: string
  /** Names of the first few to sign up, in the order they did. */
  players: string[]
  /** In coins; 0 is free. */
  fee: number
  registered: number
  joined: boolean
}

interface OpenTournamentRow {
  id: string
  name: string
  starts_at: Date
  registration_closes_at: Date
  players_per_room: number
  min_players: number | null
  max_players: number | null
  format: TournamentFormat | null
  rounds: number | null
  description: string | null
  registration_opens_at: Date
  prizes: TournamentPrize[]
  players: string[]
  fee: number
  registered: number
  joined: boolean
}

/** Tournaments of a game whose registration is open now, and whether this player is in. */
export async function listOpen(
  sql: SQL,
  game: string,
  playerId: string,
): Promise<OpenTournament[]> {
  const rows = await sql`
		SELECT
			t.id,
			t.name,
			t.starts_at,
			t.registration_closes_at,
			t.players_per_room,
			t.min_players,
			t.max_players,
			t.format,
			t.rounds,
			t.description,
			t.registration_opens_at,
			coalesce(
				(
					SELECT json_agg(
						json_build_object('place', prize.place, 'coins', prize.coins, 'extra', prize.extra)
						ORDER BY prize.place
					)
					FROM tournament_prizes prize
					WHERE prize.tournament_id = t.id
				),
				'[]'
			) AS prizes,
			coalesce(
				(
					SELECT json_agg(first_in.display_name ORDER BY first_in.created_at, first_in.player_id)
					FROM (
						SELECT p.display_name, x.created_at, x.player_id
						FROM tournament_players x
						JOIN players p ON p.id = x.player_id
						WHERE x.tournament_id = t.id
							AND x.status = 'registered'
						ORDER BY x.created_at, x.player_id
						LIMIT ${PLAYERS_SHOWN}
					) first_in
				),
				'[]'
			) AS players,
			t.fee,
			(
				SELECT count(*)::int
				FROM tournament_players x
				WHERE x.tournament_id = t.id AND x.status = 'registered'
			) AS registered,
			EXISTS (
				SELECT 1
				FROM tournament_players x
				WHERE x.tournament_id = t.id
					AND x.player_id = ${playerId}
					AND x.status = 'registered'
			) AS joined
		FROM tournaments t
		WHERE t.game_slug = ${game}
			AND t.cancelled_at IS NULL
			AND t.distributed_at IS NULL
			-- Still listed after sign-up closes, until the job hands out its tables (up to a minute later): the lobby
			-- shows it as starting soon instead of dropping it and bringing it back as running.
			AND t.registration_opens_at <= now()
		ORDER BY t.starts_at
		LIMIT ${LIST_LIMIT}`

  return rows.map((row: OpenTournamentRow) => ({
    id: row.id,
    name: row.name,
    startsAt: row.starts_at.toISOString(),
    registrationClosesAt: row.registration_closes_at.toISOString(),
    playersPerRoom: row.players_per_room,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    format: row.format,
    rounds: row.rounds,
    description: row.description,
    registrationOpensAt: row.registration_opens_at.toISOString(),
    prizes: row.prizes,
    players: row.players,
    fee: row.fee,
    registered: row.registered,
    joined: row.joined,
  }))
}

/** Signs the player up. Signing up twice is a no-op; a disqualified player can't sign up again. */
export async function joinTournament(
  sql: SQL,
  tournamentId: string,
  playerId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId)
    requireOpenRegistration(tournament)

    const [signedUp] = await tx`
			SELECT status
			FROM tournament_players
			WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}`

    if (signedUp?.status === 'disqualified') {
      throw new ApiError('forbidden', 403, 'You were disqualified from this tournament.')
    }

    if (signedUp?.status === 'registered') {
      return
    }

    await requireFreePlace(tx, tournamentId, tournament.max_players)

    const fee = Number(tournament.fee)
    const [added] = await tx`
			INSERT INTO tournament_players (tournament_id, player_id, fee_paid)
			VALUES (${tournamentId}, ${playerId}, ${fee})
			ON CONFLICT DO NOTHING
			RETURNING player_id`

    // The fee is taken with the sign-up, in the same transaction: no seat without paying, no charge without a seat.
    if (added && fee > 0) {
      await moveCoins(tx, { playerId, amount: -fee, reason: 'tournament_fee', tournamentId })
    }
  })
}

/**
 * Signs the player out. While registration is open, the sign-up is deleted. Once the tables are handed out, the
 * player withdraws: their seat is freed and they can't come back. Refused once their table started; they leave it
 * from the table then. Signing out when not signed up is a no-op.
 */
export async function leaveTournament(
  sql: SQL,
  tournamentId: string,
  playerId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId)

    // Only a player still in can leave: a withdrawn or disqualified one is already out, and gets no fee back
    // by trying again (a disqualified player's fee is kept).
    const [signUp] = await tx`
			SELECT status
			FROM tournament_players
			WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}
			FOR UPDATE`
    if (signUp?.status !== 'registered') {
      return
    }

    if (!tournament.distributed_at) {
      requireOpenRegistration(tournament)

      await refundSignUp(tx, tournamentId, playerId)
      await tx`
				DELETE FROM tournament_players
				WHERE tournament_id = ${tournamentId}
					AND player_id = ${playerId}
					AND status = 'registered'`
      return
    }

    // Their latest seat decides: one that is playing now is left from the table; a waiting one is freed; after a
    // played round, withdrawing keeps them out of the next.
    const [seat] = await tx`
			SELECT ra.room_id, r.started_at, r.closed_at
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			JOIN tournament_players tp
				ON tp.tournament_id = ra.tournament_id AND tp.player_id = ra.player_id
			WHERE ra.tournament_id = ${tournamentId}
				AND ra.player_id = ${playerId}
				AND tp.status = 'registered'
			ORDER BY ra.tournament_round DESC
			LIMIT 1`

    const playingNow = seat?.started_at && !seat.closed_at
    if (playingNow) {
      throw new ApiError(
        'conflict',
        409,
        'Your table already started. Leave it from the table instead.',
      )
    }

    if (seat && !seat.started_at) {
      await tx`
				DELETE FROM room_assignments
				WHERE room_id = ${seat.room_id} AND player_id = ${playerId}`
    }

    // Nothing played yet: the fee comes back (Erdin, 2026-11-13).
    const played = await hasPlayed(tx, tournamentId, playerId)
    if (!played) {
      await refundSignUp(tx, tournamentId, playerId)
    }

    await tx`
			UPDATE tournament_players
			SET status = 'withdrawn', status_changed_at = now()
			WHERE tournament_id = ${tournamentId}
				AND player_id = ${playerId}
				AND status = 'registered'`
  })
}

/** The parts of a locked tournament row a sign-up or withdraw reads. */
interface LockedTournament {
  distributed_at: Date | null
  max_players: number | null
  fee: number
  open: boolean
}

/**
 * The tournament, refused when missing or cancelled. FOR UPDATE holds the row for the transaction, so a distribute
 * run on the same tournament waits, and two sign-ups can't both take its last place.
 */
async function lockTournament(tx: SQL, tournamentId: string): Promise<LockedTournament> {
  const [tournament] = await tx<(LockedTournament & { cancelled_at: Date | null })[]>`
		SELECT
			cancelled_at,
			distributed_at,
			max_players,
			fee,
			registration_opens_at <= now() AND registration_closes_at > now() AS open
		FROM tournaments
		WHERE id = ${tournamentId}
		FOR UPDATE`

  if (!tournament) {
    throw new ApiError('not_found', 404, 'There is no such tournament.')
  }

  if (tournament.cancelled_at) {
    throw new ApiError('conflict', 409, 'This tournament was cancelled.')
  }

  return tournament
}

/** Whether the player ever sat at a table of this tournament that started. */
async function hasPlayed(tx: SQL, tournamentId: string, playerId: string): Promise<boolean> {
  const [row] = await tx`
		SELECT EXISTS (
			SELECT 1
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${tournamentId}
				AND ra.player_id = ${playerId}
				AND r.started_at IS NOT NULL
		) AS played`

  return row.played
}

/**
 * Refuses a sign-up when the tournament is full; NULL takes anyone. The caller holds the tournament row, so the
 * count can't change under it.
 */
async function requireFreePlace(tx: SQL, tournamentId: string, maxPlayers: number | null) {
  if (maxPlayers === null) {
    return
  }

  const [{ registered }] = await tx`
		SELECT count(*)::int AS registered
		FROM tournament_players
		WHERE tournament_id = ${tournamentId}
			AND status = 'registered'`

  if (registered >= maxPlayers) {
    throw new ApiError('conflict', 409, 'Sign-up is closed: this tournament is full.')
  }
}

function requireOpenRegistration(tournament: { distributed_at: Date | null; open: boolean }) {
  if (!tournament.open || tournament.distributed_at) {
    throw new ApiError('conflict', 409, 'Registration for this tournament is closed.')
  }
}
