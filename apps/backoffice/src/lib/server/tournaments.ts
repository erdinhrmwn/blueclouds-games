import type { SQL } from 'bun';
import { z } from 'zod';
import { DistributeError, distributeIn } from '../../../../platform/src/services/tournaments.ts';
import { FEE_MAX, MAX_PLAYERS_LIMIT, PRIZE_PLACES_MAX, TOURNAMENT_TEXT_MAX } from '../limits.ts';
import { TOURNAMENT_FORMATS, type TournamentFormat } from '../tournament-status.ts';
import type { Admin } from './auth.ts';
import { audit } from './auth.ts';
import { isUuid } from './players.ts';

/** Most player ids one paste may register. */
export const REGISTER_MAX = 500;
const LIST_LIMIT = 100;

/** Longest reason a disqualification may give. */
export const REASON_MAX = 200;

/** How many unknown ids an error message names before it cuts off. */
const UNKNOWN_IDS_SHOWN = 5;

/** Sign-up closes this long before the start unless the admin picks a time. */
const CLOSE_BEFORE_START_MS = 10 * 60_000;

/** A rule an admin broke; the message is shown on the form. */
export class TournamentError extends Error {}

export type TournamentRow = {
	id: string;
	game: string;
	gameName: string;
	name: string;
	playersPerRoom: number;
	/** Fewest players it runs with, else the job cancels it; null for tournaments made before the limits existed. */
	minPlayers: number | null;
	/** Most sign-ups; reaching it closes sign-up. */
	maxPlayers: number | null;
	format: TournamentFormat | null;
	description: string | null;
	/** By finishing place, 1st first. */
	prizes: Prize[];
	/** In coins; 0 is free. */
	fee: number;
	startsAt: Date;
	registrationOpensAt: Date;
	registrationClosesAt: Date;
	distributedAt: Date | null;
	distributeError: string | null;
	cancelledAt: Date | null;
	/** Why the platform cancelled it by itself; null when an admin did. */
	cancelReason: string | null;
	endedAt: Date | null;
	registered: number;
	rooms: number;
};

export type Prize = { place: number; coins: number; extra: string | null };

/** A final place, written once by the platform's job when the tournament finished. */
export type TournamentResult = {
	place: number;
	playerId: string;
	name: string;
	wins: number;
	lastRound: number;
};

export type PlayerStatus = 'registered' | 'withdrawn' | 'disqualified';

export type Registered = {
	playerId: string;
	name: string;
	disabled: boolean;
	byAdmin: boolean;
	status: PlayerStatus;
	/** Why they were disqualified. */
	statusReason: string | null;
	statusChangedAt: Date | null;
	roomCode: string | null;
	seat: number | null;
};

export type TournamentRoom = {
	id: string;
	code: string;
	/** The tournament round this table played in. */
	round: number;
	/** Who sits where at this table. */
	seats: { playerId: string; seat: number | null }[];
	startedAt: Date | null;
	closedAt: Date | null;
	closeReason: string | null;
	players: number;
};

const COLUMNS = (sql: SQL) => sql`
	t.id,
	t.game_slug AS game,
	g.name AS "gameName",
	t.name,
	t.players_per_room AS "playersPerRoom",
	t.min_players AS "minPlayers",
	t.max_players AS "maxPlayers",
	t.format,
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
	(
		SELECT count(*)::int FROM tournament_players tp
		WHERE tp.tournament_id = t.id AND tp.status = 'registered'
	) AS registered,
	(SELECT count(*)::int FROM rooms r WHERE r.tournament_id = t.id) AS rooms`;

/** Newest start first. */
export async function listTournaments(sql: SQL): Promise<TournamentRow[]> {
	const rows = await sql`
		SELECT ${COLUMNS(sql)}
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		ORDER BY t.starts_at DESC
		LIMIT ${LIST_LIMIT}`;

	return rows as TournamentRow[];
}

/** A `datetime-local` value, read as UTC like every time in the backoffice. */
const UtcTime = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and time.')
	.transform((value) => new Date(`${value}:00Z`));

const FORMAT_VALUES = TOURNAMENT_FORMATS.map((format) => format.value) as [
	TournamentFormat,
	...TournamentFormat[]
];

/**
 * Prize rows from the form's repeated `prizeCoins` and `prizeExtra` fields, in place order. Rows left fully blank
 * are dropped, so the places that follow move up.
 */
export function prizeRows(coins: string[], extras: string[]) {
	const rows = coins.map((value, index) => ({
		coins: value.trim(),
		extra: (extras[index] ?? '').trim()
	}));

	return rows.filter((row) => row.coins !== '' || row.extra !== '');
}

/** A text the admin may leave out; a blank one counts as left out. */
const optionalText = (label: string, max: number) =>
	z
		.string()
		.trim()
		.max(max, `${label}: at most ${max} characters.`)
		.optional()
		.transform((value) => value || null);

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
				extra: optionalText('Prize extra', TOURNAMENT_TEXT_MAX.prizeExtra)
			})
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
	registrationClosesAt: UtcTime.optional()
});

export async function createTournament(
	sql: SQL,
	admin: Admin,
	input: z.output<typeof NewTournament>,
	ip: string | null
): Promise<string> {
	const [game] = await sql`
		SELECT min_players, max_players, maintenance_at
		FROM games
		WHERE slug = ${input.game}`;
	if (!game) {
		throw new TournamentError('Pick a game.');
	}

	if (game.maintenance_at) {
		throw new TournamentError('This game is under maintenance. End it on the Games page first.');
	}

	const { playersPerRoom } = input;
	if (playersPerRoom < game.min_players || playersPerRoom > game.max_players) {
		throw new TournamentError(
			`Players per table must be ${game.min_players}-${game.max_players} for this game.`
		);
	}

	if (input.maxPlayers < playersPerRoom) {
		throw new TournamentError('Most players must be at least the players per table.');
	}

	const { minPlayers } = input;
	if (minPlayers < game.min_players || minPlayers > input.maxPlayers) {
		throw new TournamentError(
			`Fewest players must be ${game.min_players}-${input.maxPlayers} for this game and most players.`
		);
	}

	const now = new Date();
	const defaultClose = new Date(input.startsAt.getTime() - CLOSE_BEFORE_START_MS);
	const opens = input.registrationOpensAt ?? now;
	const closes = input.registrationClosesAt ?? defaultClose;

	if (input.startsAt <= now) {
		throw new TournamentError('The start must be in the future.');
	}

	const windowIsValid = opens < closes && closes <= input.startsAt;
	if (!windowIsValid) {
		throw new TournamentError(
			'Sign-up must open before it closes, and close no later than the start.'
		);
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
				${input.description},
				${input.fee},
				${input.startsAt},
				${opens},
				${closes},
				${admin.id}
			)
			RETURNING id`;

		if (input.prizes.length > 0) {
			const prizes = input.prizes.map((prize, index) => ({
				tournament_id: row.id,
				place: index + 1,
				coins: prize.coins,
				extra: prize.extra
			}));
			await tx`INSERT INTO tournament_prizes ${tx(prizes)}`;
		}

		await audit(tx, {
			adminId: admin.id,
			action: 'tournament.create',
			tournamentId: row.id,
			detail: { name: input.name, game: input.game },
			ip
		});

		return row.id as string;
	});
}

export async function tournamentDetail(sql: SQL, id: string) {
	if (!isUuid(id)) return null;

	const [tournament] = (await sql`
		SELECT ${COLUMNS(sql)}
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		WHERE t.id = ${id}`) as TournamentRow[];

	if (!tournament) return null;

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
		ORDER BY latest.code NULLS LAST, latest.seat, p.display_name`;

	const roomsQuery = sql`
		SELECT
			r.id,
			r.code,
			r.tournament_round AS round,
			r.started_at AS "startedAt",
			r.closed_at AS "closedAt",
			r.close_reason AS "closeReason",
			(SELECT count(*)::int FROM room_assignments ra WHERE ra.room_id = r.id) AS players,
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
		ORDER BY r.tournament_round DESC, r.code`;

	const resultsQuery = sql`
		SELECT
			tr.place,
			tr.player_id AS "playerId",
			p.display_name AS name,
			tr.wins,
			tr.last_round AS "lastRound"
		FROM tournament_results tr
		JOIN players p ON p.id = tr.player_id
		WHERE tr.tournament_id = ${id}
		ORDER BY tr.place`;

	const [players, rooms, results] = await Promise.all([playersQuery, roomsQuery, resultsQuery]);

	return {
		tournament,
		players: [...players] as Registered[],
		rooms: [...rooms] as TournamentRoom[],
		results: [...results] as TournamentResult[]
	};
}

/** Player ids from a paste: one per line, or separated by commas or spaces. */
export function parseIds(text: string): { ids: string[]; invalid: string[] } {
	const parts = [...new Set(text.split(/[\s,]+/).filter(Boolean))];

	return {
		ids: parts.filter(isUuid).map((part) => part.toLowerCase()),
		invalid: parts.filter((part) => !isUuid(part))
	};
}

/** Locks the tournament for a change and refuses one that is cancelled or already handed out its tables. */
async function lockOpen(tx: SQL, id: string) {
	const [tournament] = await tx`
		SELECT name, distributed_at, cancelled_at, ended_at, players_per_room, max_players
		FROM tournaments
		WHERE id = ${id}
		FOR UPDATE`;

	if (!tournament) {
		throw new TournamentError('This tournament no longer exists.');
	}
	if (tournament.cancelled_at) {
		throw new TournamentError('This tournament was cancelled.');
	}

	return tournament;
}

/**
 * Registers players by id until the tables are handed out (admins aren't held to the sign-up window).
 * Returns how many were added; ids already in are skipped, unknown ones refuse the whole paste.
 */
export async function registerPlayers(
	sql: SQL,
	admin: Admin,
	id: string,
	ids: string[],
	ip: string | null
): Promise<{ added: number; already: number }> {
	if (ids.length === 0) {
		throw new TournamentError('Paste at least one player id.');
	}
	if (ids.length > REGISTER_MAX) {
		throw new TournamentError(`Paste at most ${REGISTER_MAX} ids at a time.`);
	}

	return sql.begin(async (tx) => {
		const tournament = await lockOpen(tx, id);
		if (tournament.distributed_at) {
			throw new TournamentError(
				'Tables are already handed out. Add a player to a table below instead.'
			);
		}

		const knownRows = await tx`SELECT id FROM players WHERE id IN ${tx(ids)}`;
		const known = new Set(knownRows.map((row: { id: string }) => row.id));

		const unknown = ids.filter((playerId) => !known.has(playerId));
		if (unknown.length > 0) {
			const shown = unknown.slice(0, UNKNOWN_IDS_SHOWN).join(', ');
			const more = unknown.length > UNKNOWN_IDS_SHOWN ? ', …' : '';
			throw new TournamentError(`Unknown player ids: ${shown}${more}`);
		}

		await requireFreePlaces(tx, id, tournament.max_players, ids);

		const rows = ids.map((playerId) => ({
			tournament_id: id,
			player_id: playerId,
			registered_by_admin_id: admin.id
		}));

		const added = await tx`
			INSERT INTO tournament_players ${tx(rows)}
			ON CONFLICT DO NOTHING
			RETURNING player_id`;

		if (added.length > 0) {
			await audit(tx, {
				adminId: admin.id,
				action: 'tournament.register',
				tournamentId: id,
				detail: { players: added.length },
				ip
			});
		}

		return { added: added.length, already: ids.length - added.length };
	});
}

/**
 * Refuses a paste that would take the tournament past its most players; ids already in don't count. NULL takes
 * anyone. The caller holds the tournament row, so the count can't change under it.
 */
async function requireFreePlaces(
	tx: SQL,
	id: string,
	maxPlayers: number | null,
	ids: string[]
): Promise<void> {
	if (maxPlayers === null) return;

	const [counts] = await tx`
		SELECT
			count(*) FILTER (WHERE status = 'registered')::int AS registered,
			count(*) FILTER (WHERE player_id IN ${tx(ids)})::int AS already
		FROM tournament_players
		WHERE tournament_id = ${id}`;

	const free = Math.max(maxPlayers - counts.registered, 0);
	const adding = ids.length - counts.already;

	if (adding > free) {
		throw new TournamentError(
			`Only ${free} of ${maxPlayers} places are left; this paste adds ${adding}.`
		);
	}
}

/** Takes a player out, and off their table first. Refused once their table started. */
export async function unregisterPlayer(
	sql: SQL,
	admin: Admin,
	id: string,
	playerId: string,
	ip: string | null
): Promise<void> {
	await sql.begin(async (tx) => {
		await lockOpen(tx, id);

		// Once they played any round, their seats are history: disqualify them instead.
		const [seats] = await tx`
			SELECT coalesce(bool_or(r.started_at IS NOT NULL), false) AS played
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${id} AND ra.player_id = ${playerId}`;

		if (seats.played) {
			throw new TournamentError('Their table already started.');
		}

		await tx`
			DELETE FROM room_assignments
			WHERE tournament_id = ${id} AND player_id = ${playerId}`;

		const [gone] = await tx`
			DELETE FROM tournament_players
			WHERE tournament_id = ${id} AND player_id = ${playerId}
			RETURNING player_id`;

		if (!gone) {
			throw new TournamentError('That player is not registered.');
		}

		await audit(tx, {
			adminId: admin.id,
			action: 'tournament.unregister',
			tournamentId: id,
			playerId,
			ip
		});
	});
}

/** "Distribute now": closes sign-up at once and hands out the tables, the same way the platform's job does. */
export async function distributeNow(
	sql: SQL,
	admin: Admin,
	id: string,
	ip: string | null
): Promise<{ rooms: number; players: number }> {
	try {
		return await sql.begin(async (tx) => {
			await tx`
				UPDATE tournaments
				SET
					registration_opens_at = least(registration_opens_at, now() - interval '1 second'),
					registration_closes_at = least(registration_closes_at, now())
				WHERE id = ${id} AND distributed_at IS NULL AND cancelled_at IS NULL`;

			return distributeIn(tx, id, { adminId: admin.id, ip });
		});
	} catch (err) {
		if (err instanceof DistributeError) {
			throw new TournamentError(err.message);
		}

		throw err;
	}
}

export async function cancelTournament(
	sql: SQL,
	admin: Admin,
	id: string,
	ip: string | null
): Promise<void> {
	await sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE tournaments
			SET cancelled_at = now()
			WHERE id = ${id} AND cancelled_at IS NULL AND ended_at IS NULL
			RETURNING id`;

		if (!row) {
			throw new TournamentError('This tournament already ended or was cancelled.');
		}

		await audit(tx, { adminId: admin.id, action: 'tournament.cancel', tournamentId: id, ip });
	});
}

/**
 * Seats a player at a table that hasn't started, on its first free seat. Registers them too if needed.
 * Nobody already seated is moved: a player at another table must be taken off it first.
 */
export async function assignPlayer(
	sql: SQL,
	admin: Admin,
	id: string,
	roomCode: string,
	playerId: string,
	ip: string | null
): Promise<number> {
	return sql.begin(async (tx) => {
		const tournament = await lockOpen(tx, id);

		const [room] = await tx`
			SELECT id, tournament_round, started_at, closed_at
			FROM rooms
			WHERE code = ${roomCode} AND tournament_id = ${id}`;

		if (!room) {
			throw new TournamentError('That table is not part of this tournament.');
		}
		if (room.started_at || room.closed_at) {
			throw new TournamentError('That table already started.');
		}

		const [player] = await tx`SELECT 1 FROM players WHERE id = ${playerId}`;
		if (!player) {
			throw new TournamentError('Unknown player id.');
		}

		const [signedUp] = await tx`
			SELECT status
			FROM tournament_players
			WHERE tournament_id = ${id} AND player_id = ${playerId}`;

		if (signedUp && signedUp.status !== 'registered') {
			throw new TournamentError(`They ${outText(signedUp.status)} and can't play in it.`);
		}

		const [otherTable] = await tx`
			SELECT r.code
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${id}
				AND ra.tournament_round = ${room.tournament_round}
				AND ra.player_id = ${playerId}`;

		if (otherTable) {
			throw new TournamentError(
				`They already sit at table ${otherTable.code}. Take them off it first.`
			);
		}

		const seat = await firstFreeSeat(tx, room.id, tournament.players_per_room);
		if (seat === undefined) {
			throw new TournamentError('That table is full.');
		}

		await tx`
			INSERT INTO tournament_players (tournament_id, player_id, registered_by_admin_id)
			VALUES (${id}, ${playerId}, ${admin.id})
			ON CONFLICT DO NOTHING`;

		await tx`
			INSERT INTO room_assignments (
				room_id,
				tournament_id,
				tournament_round,
				player_id,
				seat,
				assigned_by_admin_id
			)
			VALUES (
				${room.id},
				${id},
				${room.tournament_round},
				${playerId},
				${seat},
				${admin.id}
			)`;

		await audit(tx, {
			adminId: admin.id,
			action: 'room.assign',
			tournamentId: id,
			roomId: room.id,
			playerId,
			detail: { seat },
			ip
		});

		return seat;
	});
}

/** The lowest seat number no one at the room holds, or undefined when the table is full. */
async function firstFreeSeat(
	tx: SQL,
	roomId: string,
	seatCount: number
): Promise<number | undefined> {
	const rows = await tx`SELECT seat FROM room_assignments WHERE room_id = ${roomId}`;
	const taken = new Set(rows.map((row: { seat: number | null }) => row.seat));
	const allSeats = Array.from({ length: seatCount }, (_, seat) => seat);

	return allSeats.find((seat) => !taken.has(seat));
}

/** Takes a player off a table that hasn't started. They stay registered. */
export async function unassignPlayer(
	sql: SQL,
	admin: Admin,
	id: string,
	playerId: string,
	ip: string | null
): Promise<void> {
	await sql.begin(async (tx) => {
		await lockOpen(tx, id);

		// Their seat in the latest round they were given one.
		const [seat] = await tx`
			SELECT ra.room_id, r.started_at
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			WHERE ra.tournament_id = ${id} AND ra.player_id = ${playerId}
			ORDER BY ra.tournament_round DESC
			LIMIT 1`;

		if (!seat) {
			throw new TournamentError('That player has no table.');
		}
		if (seat.started_at) {
			throw new TournamentError('Their table already started.');
		}

		await tx`
			DELETE FROM room_assignments
			WHERE room_id = ${seat.room_id} AND player_id = ${playerId}`;

		await audit(tx, {
			adminId: admin.id,
			action: 'room.unassign',
			tournamentId: id,
			roomId: seat.room_id,
			playerId,
			ip
		});
	});
}

const outText = (status: PlayerStatus) =>
	status === 'withdrawn'
		? 'withdrew from this tournament'
		: 'were disqualified from this tournament';

/**
 * Puts a player out of the tournament for good, with a reason; they can't sign up or sit down again. At a table
 * that hasn't started their seat is freed, and the room drops them at the start if they already sat down. At a
 * running table the seat stays on record and the room won't let them back in; returns that table, since they may
 * still be playing at it.
 */
export async function disqualifyPlayer(
	sql: SQL,
	admin: Admin,
	id: string,
	target: { playerId: string; reason: string },
	ip: string | null
): Promise<{ runningTable: string | null }> {
	const reason = target.reason.trim();
	if (!reason || reason.length > REASON_MAX) {
		throw new TournamentError(`Give a reason, up to ${REASON_MAX} characters.`);
	}

	return sql.begin(async (tx) => {
		const tournament = await lockOpen(tx, id);
		if (tournament.ended_at) {
			throw new TournamentError('This tournament already ended.');
		}

		const [player] = await tx`
			SELECT tp.status, latest.room_id, latest.code, latest.started_at, latest.closed_at
			FROM tournament_players tp
			-- Their seat in the latest round they were given one.
			LEFT JOIN LATERAL (
				SELECT r.id AS room_id, r.code, r.started_at, r.closed_at
				FROM room_assignments ra
				JOIN rooms r ON r.id = ra.room_id
				WHERE ra.tournament_id = tp.tournament_id AND ra.player_id = tp.player_id
				ORDER BY ra.tournament_round DESC
				LIMIT 1
			) latest ON true
			WHERE tp.tournament_id = ${id} AND tp.player_id = ${target.playerId}
			FOR UPDATE OF tp`;

		if (!player) {
			throw new TournamentError('That player is not registered.');
		}
		if (player.status !== 'registered') {
			throw new TournamentError(`They already ${outText(player.status)}.`);
		}

		const running = !!player.started_at;
		if (player.room_id && !running) {
			await tx`
				DELETE FROM room_assignments
				WHERE room_id = ${player.room_id} AND player_id = ${target.playerId}`;
		}

		await tx`
			UPDATE tournament_players
			SET status = 'disqualified', status_reason = ${reason}, status_changed_at = now()
			WHERE tournament_id = ${id} AND player_id = ${target.playerId}`;

		await audit(tx, {
			adminId: admin.id,
			action: 'tournament.disqualify',
			tournamentId: id,
			roomId: player.room_id,
			playerId: target.playerId,
			detail: { reason },
			ip
		});

		return { runningTable: running && !player.closed_at ? player.code : null };
	});
}

export type TournamentTable = {
	id: string;
	code: string;
	game: string;
	gameName: string;
	tournamentId: string;
	tournamentName: string;
	/** Seats at the game's table, filled or not. */
	seatCount: number;
	startedAt: Date | null;
	seats: { playerId: string; name: string; seat: number | null }[];
};

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
		ORDER BY t.starts_at, r.code`;

	return rows as TournamentTable[];
}
