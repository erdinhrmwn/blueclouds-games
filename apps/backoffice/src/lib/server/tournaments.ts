// Tournaments in the backoffice: the list, creating one, its detail page with who gets which prize, handing out its
// tables and cancelling. Players and seats: tournament-players.ts. Paying the prizes: tournament-prizes.ts.

import type { SQL } from 'bun'
import { z } from 'zod'
import {
  FEE_MAX,
  MAX_PLAYERS_LIMIT,
  PRIZE_PLACES_MAX,
  ROUNDS_DEFAULT,
  ROUNDS_MAX,
  TOURNAMENT_TEXT_MAX,
} from '../limits.ts'
import { TOURNAMENT_FORMATS, type TournamentFormat } from '../tournament-status.ts'
import type { Admin } from './auth.ts'
import { audit } from './auth.ts'
import { refundEveryone } from './coins.ts'
import { DistributeError, distributeIn } from './distribute.ts'
import { isUuid } from './players.ts'

const LIST_LIMIT = 100

/** Sign-up closes this long before the start unless the admin picks a time. */
const CLOSE_BEFORE_START_MS = 10 * 60_000

/** A rule an admin broke; the message is shown on the form. */
export class TournamentError extends Error {}

export interface TournamentRow {
  id: string
  game: string
  gameName: string
  name: string
  playersPerRoom: number
  /** Fewest players it runs with, else the job cancels it; null for tournaments made before the limits existed. */
  minPlayers: number | null
  /** Most sign-ups; reaching it closes sign-up. */
  maxPlayers: number | null
  format: TournamentFormat | null
  /** Arena and Swiss: how many rounds it plays; null for a knockout (until one player is left). */
  rounds: number | null
  description: string | null
  /** By finishing place, 1st first. */
  prizes: Prize[]
  /** In coins; 0 is free. */
  fee: number
  startsAt: Date
  registrationOpensAt: Date
  registrationClosesAt: Date
  distributedAt: Date | null
  distributeError: string | null
  cancelledAt: Date | null
  /** When an admin paid the prizes out; null before. */
  prizesPaidAt: Date | null
  /** Coins the players paid in fees and haven't had back. */
  feesHeld: bigint | number
  /** Why the platform cancelled it by itself; null when an admin did. */
  cancelReason: string | null
  endedAt: Date | null
  registered: number
  rooms: number
}

export interface Prize {
  place: number
  coins: number
  extra: string | null
}

/** A final place, written once by the platform's job when the tournament finished. */
export interface TournamentResult {
  place: number
  playerId: string
  name: string
  wins: number
  /** Arena and Swiss points; 0 in a knockout. */
  points: number
  lastRound: number
}

export type PlayerStatus = 'registered' | 'withdrawn' | 'disqualified'

export interface Registered {
  playerId: string
  name: string
  disabled: boolean
  byAdmin: boolean
  status: PlayerStatus
  /** Why they were disqualified. */
  statusReason: string | null
  statusChangedAt: Date | null
  roomCode: string | null
  seat: number | null
}

export interface TournamentRoom {
  id: string
  code: string
  /** The tournament round this table played in. */
  round: number
  /** Who sits where at this table. */
  seats: { playerId: string; seat: number | null }[]
  startedAt: Date | null
  closedAt: Date | null
  closeReason: string | null
  players: number
}

const COLUMNS = (sql: SQL) => sql`
	t.id,
	t.game_slug AS game,
	g.name AS "gameName",
	t.name,
	t.players_per_room AS "playersPerRoom",
	t.min_players AS "minPlayers",
	t.max_players AS "maxPlayers",
	t.format,
	t.rounds,
	t.description,
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
	t.fee,
	t.starts_at AS "startsAt",
	t.registration_opens_at AS "registrationOpensAt",
	t.registration_closes_at AS "registrationClosesAt",
	t.distributed_at AS "distributedAt",
	t.distribute_error AS "distributeError",
	t.cancelled_at AS "cancelledAt",
	t.cancel_reason AS "cancelReason",
	t.ended_at AS "endedAt",
	t.prizes_paid_at AS "prizesPaidAt",
	(
		SELECT coalesce(sum(tp.fee_paid), 0)::bigint
		FROM tournament_players tp
		WHERE tp.tournament_id = t.id
	) AS "feesHeld",
	(
		SELECT count(*)::int
		FROM tournament_players tp
		WHERE tp.tournament_id = t.id AND tp.status = 'registered'
	) AS registered,
	(
		SELECT count(*)::int
		FROM rooms r
		WHERE r.tournament_id = t.id
	) AS rooms`

/** Newest start first. */
export async function listTournaments(sql: SQL): Promise<TournamentRow[]> {
  const rows = await sql`
		SELECT ${COLUMNS(sql)}
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		ORDER BY t.starts_at DESC
		LIMIT ${LIST_LIMIT}`

  return rows as TournamentRow[]
}

/** A `datetime-local` value, read as UTC like every time in the backoffice. */
const UtcTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and time.')
  .transform((value) => new Date(`${value}:00Z`))

const FORMAT_VALUES = TOURNAMENT_FORMATS.map((format) => format.value) as [
  TournamentFormat,
  ...TournamentFormat[],
]

/**
 * Prize rows from the form's repeated `prizeCoins` and `prizeExtra` fields, in place order. Rows left fully blank
 * are dropped, so the places that follow move up.
 */
export function prizeRows(coins: string[], extras: string[]) {
  const rows = coins.map((value, index) => ({
    coins: value.trim(),
    extra: (extras[index] ?? '').trim(),
  }))

  return rows.filter((row) => row.coins !== '' || row.extra !== '')
}

/** A text the admin may leave out; a blank one counts as left out. */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}: at most ${max} characters.`)
    .optional()
    .transform((value) => value || null)

export const NewTournament = z.object({
  game: z.string().min(1, 'Pick a game.'),
  name: z
    .string()
    .trim()
    .min(1, 'Give it a name of 1-80 characters.')
    .max(80, 'Give it a name of 1-80 characters.'),
  playersPerRoom: z.coerce.number().int('Must be a whole number.'),
  minPlayers: z.coerce.number().int('Must be a whole number.'),
  maxPlayers: z.coerce
    .number()
    .int('Must be a whole number.')
    .max(MAX_PLAYERS_LIMIT, `At most ${MAX_PLAYERS_LIMIT} players.`),
  format: z.enum(FORMAT_VALUES, { message: 'Pick a format.' }),
  // Arena and Swiss only; a knockout plays until one player is left.
  rounds: z.coerce
    .number()
    .int('Stages: a whole number.')
    .min(1, `Stages: 1-${ROUNDS_MAX}.`)
    .max(ROUNDS_MAX, `Stages: 1-${ROUNDS_MAX}.`)
    .default(ROUNDS_DEFAULT),
  description: optionalText('Description', TOURNAMENT_TEXT_MAX.description),
  // 1st place first; a place may pay only an extra, like a badge.
  prizes: z
    .array(
      z.object({
        coins: z.coerce
          .number()
          .int('Prize: a whole number of coins.')
          .min(0, 'Prize: 0 or more coins.')
          .max(FEE_MAX, `Prize: at most ${FEE_MAX} coins.`),
        extra: optionalText('Prize extra', TOURNAMENT_TEXT_MAX.prizeExtra),
      }),
    )
    .max(PRIZE_PLACES_MAX, `At most ${PRIZE_PLACES_MAX} paid places.`)
    .default([]),
  // Coins; left empty, the tournament is free.
  fee: z.coerce
    .number()
    .int('Fee: a whole number of coins.')
    .min(0, 'Fee: 0 or more coins.')
    .max(FEE_MAX, `Fee: at most ${FEE_MAX} coins.`)
    .default(0),
  startsAt: UtcTime,
  registrationOpensAt: UtcTime.optional(),
  registrationClosesAt: UtcTime.optional(),
})

export async function createTournament(
  sql: SQL,
  admin: Admin,
  input: z.output<typeof NewTournament>,
  ip: string | null,
): Promise<string> {
  const [game] = await sql`
		SELECT min_players, max_players, maintenance_at
		FROM games
		WHERE slug = ${input.game}`
  if (!game) {
    throw new TournamentError('Pick a game.')
  }

  if (game.maintenance_at) {
    throw new TournamentError('This game is under maintenance. End it on the Games page first.')
  }

  const { playersPerRoom } = input
  if (playersPerRoom < game.min_players || playersPerRoom > game.max_players) {
    throw new TournamentError(
      `Players per table must be ${game.min_players}-${game.max_players} for this game.`,
    )
  }

  if (input.maxPlayers < playersPerRoom) {
    throw new TournamentError('Most players must be at least the players per table.')
  }

  const { minPlayers } = input
  if (minPlayers < game.min_players || minPlayers > input.maxPlayers) {
    throw new TournamentError(
      `Fewest players must be ${game.min_players}-${input.maxPlayers} for this game and most players.`,
    )
  }

  const now = new Date()
  const defaultClose = new Date(input.startsAt.getTime() - CLOSE_BEFORE_START_MS)
  const opens = input.registrationOpensAt ?? now
  const closes = input.registrationClosesAt ?? defaultClose

  if (input.startsAt <= now) {
    throw new TournamentError('The start must be in the future.')
  }

  const windowIsValid = opens < closes && closes <= input.startsAt
  if (!windowIsValid) {
    throw new TournamentError(
      'Sign-up must open before it closes, and close no later than the start.',
    )
  }

  return sql.begin(async (tx) => {
    const [row] = await tx`
			INSERT INTO tournaments (
				game_slug,
				name,
				players_per_room,
				min_players,
				max_players,
				format,
				rounds,
				description,
				fee,
				starts_at,
				registration_opens_at,
				registration_closes_at,
				created_by_admin_id
			)
			VALUES (
				${input.game},
				${input.name},
				${playersPerRoom},
				${minPlayers},
				${input.maxPlayers},
				${input.format},
				${input.format === 'knockout' ? null : input.rounds},
				${input.description},
				${input.fee},
				${input.startsAt},
				${opens},
				${closes},
				${admin.id}
			)
			RETURNING id`

    if (input.prizes.length > 0) {
      const prizes = input.prizes.map((prize, index) => ({
        tournament_id: row.id,
        place: index + 1,
        coins: prize.coins,
        extra: prize.extra,
      }))
      await tx`INSERT INTO tournament_prizes ${tx(prizes)}`
    }

    await audit(tx, {
      adminId: admin.id,
      action: 'tournament.create',
      tournamentId: row.id,
      detail: { name: input.name, game: input.game },
      ip,
    })

    return row.id as string
  })
}

export async function tournamentDetail(sql: SQL, id: string) {
  if (!isUuid(id)) {
    return null
  }

  const [tournament] = (await sql`
		SELECT ${COLUMNS(sql)}
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		WHERE t.id = ${id}`) as TournamentRow[]

  if (!tournament) {
    return null
  }

  const playersQuery = sql`
		SELECT
			tp.player_id AS "playerId",
			p.display_name AS name,
			p.disabled_at IS NOT NULL AS disabled,
			tp.registered_by_admin_id IS NOT NULL AS "byAdmin",
			tp.status,
			tp.status_reason AS "statusReason",
			tp.status_changed_at AS "statusChangedAt",
			latest.code AS "roomCode",
			latest.seat
		FROM tournament_players tp
		JOIN players p ON p.id = tp.player_id
		-- Where they sit in the latest round they were given a seat.
		LEFT JOIN LATERAL (
			SELECT r.code, ra.seat
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = tp.tournament_id AND ra.player_id = tp.player_id
			ORDER BY ra.tournament_round DESC
			LIMIT 1
		) latest ON true
		WHERE tp.tournament_id = ${id}
		ORDER BY latest.code NULLS LAST, latest.seat, p.display_name`

  const roomsQuery = sql`
		SELECT
			r.id,
			r.code,
			r.tournament_round AS round,
			r.started_at AS "startedAt",
			r.closed_at AS "closedAt",
			r.close_reason AS "closeReason",
			(
				SELECT count(*)::int
				FROM room_assignments ra
				WHERE ra.room_id = r.id
			) AS players,
			coalesce(
				(
					SELECT json_agg(json_build_object('playerId', ra.player_id, 'seat', ra.seat) ORDER BY ra.seat)
					FROM room_assignments ra
					WHERE ra.room_id = r.id
				),
				'[]'
			) AS seats
		FROM rooms r
		WHERE r.tournament_id = ${id}
		ORDER BY r.tournament_round DESC, r.code`

  const resultsQuery = sql`
		SELECT
			tr.place,
			tr.player_id AS "playerId",
			p.display_name AS name,
			tr.wins,
			tr.points,
			tr.last_round AS "lastRound"
		FROM tournament_results tr
		JOIN players p ON p.id = tr.player_id
		WHERE tr.tournament_id = ${id}
		ORDER BY tr.place`

  const [players, rooms, results, payouts] = await Promise.all([
    playersQuery,
    roomsQuery,
    resultsQuery,
    plannedPayouts(sql, id),
  ])

  return {
    tournament: { ...tournament, feesHeld: Number(tournament.feesHeld) },
    players: [...players] as Registered[],
    rooms: [...rooms] as TournamentRoom[],
    results: [...results] as TournamentResult[],
    payouts,
  }
}

/** Locks the tournament for a change and refuses one that is cancelled or already handed out its tables. */
export async function lockOpen(tx: SQL, id: string) {
  const [tournament] = await tx`
		SELECT name, distributed_at, cancelled_at, ended_at, players_per_room, max_players
		FROM tournaments
		WHERE id = ${id}
		FOR UPDATE`

  if (!tournament) {
    throw new TournamentError('This tournament no longer exists.')
  }

  if (tournament.cancelled_at) {
    throw new TournamentError('This tournament was cancelled.')
  }

  return tournament
}

/** "Distribute now": closes sign-up at once and hands out the tables, the same way the platform's job does. */
export async function distributeNow(
  sql: SQL,
  admin: Admin,
  id: string,
  ip: string | null,
): Promise<{ rooms: number; players: number }> {
  try {
    return await sql.begin(async (tx) => {
      await tx`
				UPDATE tournaments
				SET
					registration_opens_at = least(registration_opens_at, now() - interval '1 second'),
					registration_closes_at = least(registration_closes_at, now())
				WHERE id = ${id} AND distributed_at IS NULL AND cancelled_at IS NULL`

      return distributeIn(tx, id, { adminId: admin.id, ip })
    })
  } catch (err) {
    if (err instanceof DistributeError) {
      throw new TournamentError(err.message)
    }

    throw err
  }
}

export async function cancelTournament(
  sql: SQL,
  admin: Admin,
  id: string,
  ip: string | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx`
			UPDATE tournaments
			SET cancelled_at = now()
			WHERE id = ${id} AND cancelled_at IS NULL AND ended_at IS NULL
			RETURNING id`

    if (!row) {
      throw new TournamentError('This tournament already ended or was cancelled.')
    }

    const refunded = await refundEveryone(tx, id)
    await audit(tx, {
      adminId: admin.id,
      action: 'tournament.cancel',
      tournamentId: id,
      detail: { refunded },
      ip,
    })
  })
}

export interface TournamentTable {
  id: string
  code: string
  game: string
  gameName: string
  tournamentId: string
  tournamentName: string
  /** Seats at the game's table, filled or not. */
  seatCount: number
  startedAt: Date | null
  seats: { playerId: string; name: string; seat: number | null }[]
}

/** Tournament tables that are handed out and not closed yet, with who is seated at each. */
export async function tournamentTables(sql: SQL): Promise<TournamentTable[]> {
  const rows = await sql`
		SELECT
			r.id,
			r.code,
			r.game_slug AS game,
			g.name AS "gameName",
			t.id AS "tournamentId",
			t.name AS "tournamentName",
			g.max_players AS "seatCount",
			r.started_at AS "startedAt",
			coalesce(
				(
					SELECT json_agg(
						json_build_object('playerId', p.id, 'name', p.display_name, 'seat', ra.seat)
						ORDER BY ra.seat NULLS LAST, p.display_name
					)
					FROM room_assignments ra
					JOIN players p ON p.id = ra.player_id
					WHERE ra.room_id = r.id
				),
				'[]'
			) AS seats
		FROM rooms r
		JOIN tournaments t ON t.id = r.tournament_id
		JOIN games g ON g.slug = r.game_slug
		WHERE r.closed_at IS NULL
			AND t.cancelled_at IS NULL
			AND t.distributed_at IS NOT NULL
		ORDER BY t.starts_at, r.code`

  return rows as TournamentTable[]
}

export interface Payout {
  place: number
  playerId: string
  name: string
  coins: number
  extra: string | null
}

/** Who gets which prize: each prize place matched with whoever finished there. Empty until it finished. */
export async function plannedPayouts(sql: SQL, id: string): Promise<Payout[]> {
  const rows = await sql`
		SELECT
			prize.place,
			tr.player_id AS "playerId",
			p.display_name AS name,
			prize.coins,
			prize.extra
		FROM tournament_prizes prize
		JOIN tournament_results tr ON tr.tournament_id = prize.tournament_id AND tr.place = prize.place
		JOIN players p ON p.id = tr.player_id
		WHERE prize.tournament_id = ${id}
		ORDER BY prize.place`

  return [...rows] as Payout[]
}
