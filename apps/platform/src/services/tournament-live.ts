import type { SQL } from "bun";
import { ApiError } from "../lib/http";
import { type FinalPlace, finalPlaces, pointsPlaces } from "./tournament-rounds";
import { roundSeats, signUpOrderOf } from "./tournaments";

/** A finished tournament stays in its game's lobby this long, with its winners (phase 5 design). */
const FINISHED_SHOWN = "24 hours";

const LIVE_LIMIT = 20;

/** How many places a lobby card shows. */
const CARD_PLACES = 3;

/** Most rows the Detail's standings list. */
const STANDINGS_LIMIT = 200;

export type Standing = {
	place: number;
	playerId: string;
	name: string;
	points: number;
	wins: number;
	/** The furthest round they were seated in; in a knockout, below the current round means they are out. */
	lastRound: number;
	/** A bot account the platform signed up to fill the tables. */
	bot: boolean;
};

type LiveRow = {
	id: string;
	name: string;
	format: "arena" | "knockout" | "swiss" | null;
	rounds: number | null;
	round: number;
	round_starts_at: Date;
	round_started: boolean;
	starts_at: Date;
	ended_at: Date | null;
	prizes_paid_at: Date | null;
	players: number;
	prizes: { place: number; coins: number; extra: string | null }[];
	table_code: string | null;
	table_started: boolean | null;
	table_closed: boolean | null;
};

/**
 * Standings, best first: the stored results once the tournament finished, else worked out from the matches played
 * so far with the same rules the job uses at the end.
 */
export async function standingsOf(sql: SQL, tournamentId: string): Promise<Standing[]> {
	const [tournament] =
		await sql`SELECT format, ended_at FROM tournaments WHERE id = ${tournamentId}`;
	if (!tournament) {
		throw new ApiError("not_found", 404, "There is no such tournament.");
	}

	if (tournament.ended_at) {
		const rows = await sql`
			SELECT
				tr.place,
				tr.player_id AS "playerId",
				p.display_name AS name,
				tr.points,
				tr.wins,
				tr.last_round AS "lastRound",
				p.is_bot AS bot
			FROM tournament_results tr
			JOIN players p ON p.id = tr.player_id
			WHERE tr.tournament_id = ${tournamentId}
			ORDER BY tr.place
			LIMIT ${STANDINGS_LIMIT}`;

		return [...rows] as Standing[];
	}

	const [seats, signUpOrder] = await Promise.all([
		roundSeats(sql, tournamentId),
		signUpOrderOf(sql, tournamentId),
	]);
	const byPoints = tournament.format === "arena" || tournament.format === "swiss";
	const places: FinalPlace[] = byPoints
		? pointsPlaces(seats, signUpOrder)
		: finalPlaces(seats, signUpOrder);

	const ids = places.slice(0, STANDINGS_LIMIT).map((place) => place.playerId);
	const names = await namesOf(sql, ids);

	return places.slice(0, STANDINGS_LIMIT).map((place) => ({
		place: place.place,
		playerId: place.playerId,
		name: names.get(place.playerId)?.name ?? "Player",
		bot: names.get(place.playerId)?.bot ?? false,
		points: place.points,
		wins: place.wins,
		lastRound: place.lastRound,
	}));
}

async function namesOf(
	sql: SQL,
	ids: string[],
): Promise<Map<string, { name: string; bot: boolean }>> {
	if (ids.length === 0) {
		return new Map();
	}

	const rows = await sql`SELECT id, display_name, is_bot FROM players WHERE id IN ${sql(ids)}`;
	return new Map(
		rows.map((row: { id: string; display_name: string; is_bot: boolean }) => [
			row.id,
			{ name: row.display_name, bot: row.is_bot },
		]),
	);
}

/**
 * A game's tournaments that are playing, or finished within FINISHED_SHOWN: the round, when it starts, the top of
 * the standings, and the caller's own place and current table.
 */
export async function listLive(sql: SQL, game: string, playerId: string) {
	const rows = (await sql`
		SELECT
			t.id,
			t.name,
			t.format,
			t.rounds,
			tr.round,
			tr.starts_at AS round_starts_at,
			EXISTS (
				SELECT 1 FROM rooms r
				WHERE r.tournament_id = t.id AND r.tournament_round = tr.round AND r.started_at IS NOT NULL
			) AS round_started,
			t.starts_at,
			t.ended_at,
			t.prizes_paid_at,
			(
				SELECT count(DISTINCT ra.player_id)::int FROM room_assignments ra
				WHERE ra.tournament_id = t.id AND ra.tournament_round = 1
			) AS players,
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
			mine.code AS table_code,
			mine.started_at IS NOT NULL AS table_started,
			mine.closed_at IS NOT NULL AS table_closed
		FROM tournaments t
		-- The latest round.
		JOIN LATERAL (
			SELECT round, starts_at
			FROM tournament_rounds
			WHERE tournament_id = t.id
			ORDER BY round DESC
			LIMIT 1
		) tr ON true
		-- The caller's seat in that round, if they have one.
		LEFT JOIN LATERAL (
			SELECT r.code, r.started_at, r.closed_at
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			JOIN tournament_players tp
				ON tp.tournament_id = ra.tournament_id AND tp.player_id = ra.player_id
			WHERE ra.tournament_id = t.id
				AND ra.tournament_round = tr.round
				AND ra.player_id = ${playerId}
				AND tp.status = 'registered'
		) mine ON true
		WHERE t.game_slug = ${game}
			AND t.cancelled_at IS NULL
			AND t.distributed_at IS NOT NULL
			AND (t.ended_at IS NULL OR t.ended_at > now() - ${FINISHED_SHOWN}::interval)
		ORDER BY t.ended_at NULLS FIRST, t.starts_at
		LIMIT ${LIVE_LIMIT}`) as LiveRow[];

	return Promise.all(
		rows.map(async (row) => {
			const standings = await standingsOf(sql, row.id);
			const me = standings.find((standing) => standing.playerId === playerId) ?? null;

			return {
				id: row.id,
				name: row.name,
				format: row.format,
				rounds: row.rounds,
				round: row.round,
				roundStartsAt: row.round_starts_at.toISOString(),
				roundStarted: row.round_started,
				startsAt: row.starts_at.toISOString(),
				endedAt: row.ended_at?.toISOString() ?? null,
				prizesPaid: !!row.prizes_paid_at,
				players: row.players,
				prizes: row.prizes,
				top: standings.slice(0, CARD_PLACES),
				me,
				table: row.table_code
					? { code: row.table_code, started: !!row.table_started, closed: !!row.table_closed }
					: null,
			};
		}),
	);
}

/** One table of a round, with its players best finish first; a seat that wasn't played has no placement. */
export type BoardTable = {
	code: string;
	startedAt: string | null;
	closedAt: string | null;
	closeReason: string | null;
	players: {
		playerId: string;
		name: string;
		bot: boolean;
		seat: number | null;
		placement: number | null;
	}[];
};

/**
 * Everything the tournament page shows: the tournament as the lobby lists it, every round with its tables and who
 * finished where (the bracket), and the standings. Only distributed tournaments have rounds.
 */
export async function tournamentBoard(sql: SQL, tournamentId: string, playerId: string) {
	const [tournament] = await sql`
		SELECT
			t.id,
			t.game_slug,
			t.name,
			t.format,
			t.rounds,
			t.players_per_room,
			t.starts_at,
			t.ended_at,
			t.cancelled_at,
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
			) AS prizes
		FROM tournaments t
		WHERE t.id = ${tournamentId}`;

	if (!tournament) {
		throw new ApiError("not_found", 404, "There is no such tournament.");
	}

	const roundRows = await sql`
		SELECT round, starts_at, ended_at
		FROM tournament_rounds
		WHERE tournament_id = ${tournamentId}
		ORDER BY round`;

	const tableRows = await sql`
		SELECT
			r.tournament_round AS round,
			r.code,
			r.started_at,
			r.closed_at,
			r.close_reason,
			json_agg(
				json_build_object(
					'playerId', ra.player_id,
					'name', p.display_name,
					'bot', p.is_bot,
					'seat', ra.seat,
					'placement', mp.placement
				)
				ORDER BY mp.placement NULLS LAST, ra.seat
			) AS players
		FROM rooms r
		JOIN room_assignments ra ON ra.room_id = r.id
		JOIN players p ON p.id = ra.player_id
		LEFT JOIN matches m ON m.room_id = r.id
		LEFT JOIN match_players mp ON mp.match_id = m.id AND mp.player_id = ra.player_id
		WHERE r.tournament_id = ${tournamentId}
		GROUP BY r.id
		ORDER BY r.tournament_round, r.code`;

	const toIso = (value: Date | null) => value?.toISOString() ?? null;

	const rounds = roundRows.map(
		(row: { round: number; starts_at: Date; ended_at: Date | null }) => ({
			round: row.round,
			startsAt: row.starts_at.toISOString(),
			endedAt: toIso(row.ended_at),
			tables: tableRows
				.filter((table: { round: number }) => table.round === row.round)
				.map(
					(table: {
						code: string;
						started_at: Date | null;
						closed_at: Date | null;
						close_reason: string | null;
						players: BoardTable["players"];
					}): BoardTable => ({
						code: table.code,
						startedAt: toIso(table.started_at),
						closedAt: toIso(table.closed_at),
						closeReason: table.close_reason,
						players: table.players,
					}),
				),
		}),
	);

	const standings = await standingsOf(sql, tournamentId);
	const me = standings.find((standing) => standing.playerId === playerId) ?? null;
	const players = new Set(
		rounds.flatMap((round: { tables: BoardTable[] }) =>
			round.tables.flatMap((table) => table.players.map((seat) => seat.playerId)),
		),
	).size;

	return {
		tournament: {
			id: tournament.id,
			game: tournament.game_slug,
			name: tournament.name,
			format: tournament.format,
			rounds: tournament.rounds,
			playersPerRoom: tournament.players_per_room,
			startsAt: tournament.starts_at.toISOString(),
			endedAt: toIso(tournament.ended_at),
			cancelled: !!tournament.cancelled_at,
			players,
			prizes: tournament.prizes,
		},
		rounds,
		standings,
		me,
	};
}
