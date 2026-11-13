import type { SQL, TransactionSQL } from "bun";
import { ApiError } from "../lib/http";
import { log } from "../lib/log";
import { insertRoom } from "./rooms";
import {
	type FinalPlace,
	finalPlaces,
	pointsPlaces,
	type RoundSeat,
	swissOrder,
	tableWinners,
} from "./tournament-rounds";

const JOB_BATCH = 10;

/**
 * A room nobody opened is closed this long after starts_at: the room's own 3-minute wait for late
 * players (LATE_GRACE_MS in the actor) plus a margin.
 */
const UNOPENED_CLOSE_AFTER = "4 minutes";

const LIST_LIMIT = 20;

/** The break between a round's last table closing and the next round's tables starting (Erdin, 2026-11-13). */
const ROUND_BREAK = "3 minutes";

/** Rounds an Arena or Swiss tournament plays when the admin set none (Erdin, 2026-11-13). */
const DEFAULT_ROUNDS = 3;

/** How many of a tournament's first sign-ups the lobby's Detail names ("Rina, Erdin and 3 more"). */
const PLAYERS_SHOWN = 5;

/** Why a tournament can't be distributed; the message is shown to admins as is. */
export class DistributeError extends Error {}

export type DistributeBy = { adminId: string | null; ip?: string | null };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Splits players into ceil(n / perRoom) rooms, as evenly as possible (20 at 6 → 5+5+5+5).
 * Refuses when a room would fall below the game's minimum, and says how to fix it.
 */
export function planRooms<T>(players: T[], perRoom: number, minPlayers: number): T[][] {
	const playerCount = players.length;
	if (playerCount === 0) {
		throw new DistributeError("Nobody is registered.");
	}
	if (perRoom < minPlayers) {
		throw new DistributeError(`Players per table must be at least ${minPlayers}.`);
	}

	const roomCount = Math.ceil(playerCount / perRoom);
	const baseSize = Math.floor(playerCount / roomCount);

	if (baseSize < minPlayers) {
		const toAdd = roomCount * minPlayers - playerCount;
		const toRemove = roomCount > 1 ? playerCount - (roomCount - 1) * perRoom : 0;
		const removeHint = toRemove ? ` or remove ${toRemove}` : "";
		const fix = `Add ${plural(toAdd, "player")}${removeHint}.`;

		throw new DistributeError(
			`${plural(playerCount, "player")} can't fill every table with at least ${minPlayers}. ${fix}`,
		);
	}

	// The first `bigRooms` rooms take one extra player each.
	const bigRooms = playerCount % roomCount;
	const rooms: T[][] = [];
	let start = 0;

	for (let room = 0; room < roomCount; room++) {
		const size = room < bigRooms ? baseSize + 1 : baseSize;
		rooms.push(players.slice(start, start + size));
		start += size;
	}

	return rooms;
}

/**
 * Tables for a round after the first: like planRooms, but when the players left can't fill every table to the game's
 * minimum (3 winners at 2 per table), they sit at fewer, fuller tables instead, up to the game's maximum.
 */
export function planRoundTables<T>(
	players: T[],
	perRoom: number,
	minPlayers: number,
	maxPlayers: number,
): T[][] {
	try {
		return planRooms(players, perRoom, minPlayers);
	} catch (err) {
		if (!(err instanceof DistributeError)) {
			throw err;
		}

		const tableCount = Math.floor(players.length / minPlayers);
		const biggest = Math.ceil(players.length / Math.max(tableCount, 1));
		if (tableCount < 1 || biggest > maxPlayers) {
			throw err;
		}

		return planRooms(players, biggest, minPlayers);
	}
}

/** Fisher-Yates shuffle with crypto randomness. */
function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	const random = crypto.getRandomValues(new Uint32Array(out.length));

	for (let i = out.length - 1; i > 0; i--) {
		const j = random[i]! % (i + 1);
		[out[i], out[j]] = [out[j]!, out[i]!];
	}

	return out;
}

/**
 * Opens the tournament's rooms and seats every registered player, inside the caller's transaction.
 * Locks the tournament row first, so two runs (job and "Distribute now") never both distribute.
 */
export async function distributeIn(
	tx: SQL,
	tournamentId: string,
	by: DistributeBy,
): Promise<{ rooms: number; players: number }> {
	const [tournament] = await tx`
		SELECT
			t.game_slug,
			t.players_per_room,
			t.starts_at,
			t.min_players AS tournament_min,
			t.distributed_at,
			t.cancelled_at,
			g.min_players
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		WHERE t.id = ${tournamentId}
		FOR UPDATE OF t`;

	if (!tournament) {
		throw new DistributeError("Tournament not found.");
	}
	if (tournament.cancelled_at) {
		throw new DistributeError("This tournament was cancelled.");
	}
	if (tournament.distributed_at) {
		throw new DistributeError("Players already have their tables.");
	}

	// Disabled and disqualified players can't play, so they don't take a seat.
	const registered = await tx`
		SELECT tp.player_id
		FROM tournament_players tp
		JOIN players p ON p.id = tp.player_id
		WHERE tp.tournament_id = ${tournamentId}
			AND tp.status = 'registered'
			AND p.disabled_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM room_assignments ra
				WHERE ra.tournament_id = tp.tournament_id AND ra.player_id = tp.player_id
			)`;

	const playerIds = registered.map((row: { player_id: string }) => row.player_id);

	if (tournament.tournament_min !== null && playerIds.length < tournament.tournament_min) {
		throw new DistributeError(
			`It needs at least ${plural(tournament.tournament_min, "player")}; ${playerIds.length} can play.`,
		);
	}

	const plan = planRooms<string>(
		shuffle(playerIds),
		tournament.players_per_room,
		tournament.min_players,
	);

	await seatRound(tx, {
		tournamentId,
		game: tournament.game_slug,
		round: 1,
		startsAt: tournament.starts_at,
		tables: plan,
		adminId: by.adminId,
	});

	await tx`
		UPDATE tournaments
		SET distributed_at = now(), distribute_error = NULL
		WHERE id = ${tournamentId}`;

	const result = { rooms: plan.length, players: registered.length };
	const detail = JSON.stringify({ ...result, auto: !by.adminId });

	await tx`
		INSERT INTO admin_audit_events (admin_id, action, tournament_id, detail, ip)
		VALUES (
			${by.adminId},
			'tournament.distribute',
			${tournamentId},
			${detail}::text::jsonb,
			${by.ip ?? null}::inet
		)`;

	return result;
}

/** Writes a round, its tables and who sits where; each table starts by itself at `startsAt`. */
async function seatRound(
	tx: SQL,
	round: {
		tournamentId: string;
		game: string;
		round: number;
		startsAt: Date;
		tables: string[][];
		adminId: string | null;
	},
): Promise<void> {
	await tx`
		INSERT INTO tournament_rounds (tournament_id, round, starts_at)
		VALUES (${round.tournamentId}, ${round.round}, ${round.startsAt})`;

	for (const tablePlayers of round.tables) {
		const room = await insertRoom(tx, {
			game: round.game,
			tournamentId: round.tournamentId,
			tournamentRound: round.round,
			adminId: round.adminId,
		});

		const assignments = tablePlayers.map((playerId, seat) => ({
			room_id: room.id,
			tournament_id: round.tournamentId,
			tournament_round: round.round,
			player_id: playerId,
			seat,
		}));
		await tx`INSERT INTO room_assignments ${tx(assignments)}`;
	}
}

/**
 * Cancels a tournament whose sign-up closed with fewer playable players (registered, not disabled) than its
 * minimum, audited with no admin. Returns the counts when it did, null when it has enough (or no minimum).
 */
export async function cancelIfShort(
	tx: SQL,
	tournamentId: string,
): Promise<{ registered: number; minPlayers: number } | null> {
	const [tournament] = await tx`
		SELECT
			t.min_players,
			(
				SELECT count(*)::int
				FROM tournament_players tp
				JOIN players p ON p.id = tp.player_id
				WHERE tp.tournament_id = t.id
					AND tp.status = 'registered'
					AND p.disabled_at IS NULL
			) AS registered
		FROM tournaments t
		WHERE t.id = ${tournamentId}
			AND t.cancelled_at IS NULL
			AND t.distributed_at IS NULL
		FOR UPDATE`;

	if (!tournament || tournament.min_players === null) {
		return null;
	}

	const counts = { registered: tournament.registered, minPlayers: tournament.min_players };
	if (counts.registered >= counts.minPlayers) {
		return null;
	}

	const reason = `Only ${counts.registered} of the ${counts.minPlayers} players needed signed up.`;

	await tx`
		UPDATE tournaments
		SET cancelled_at = now(), cancel_reason = ${reason}
		WHERE id = ${tournamentId}`;

	const detail = JSON.stringify({ ...counts, auto: true });

	await tx`
		INSERT INTO admin_audit_events (admin_id, action, tournament_id, detail)
		VALUES (NULL, 'tournament.cancel', ${tournamentId}, ${detail}::text::jsonb)`;

	return counts;
}

/**
 * A tournament whose current round has every table closed goes on: the round gets its end, then either the next
 * round is seated (its table winners, after ROUND_BREAK) or the tournament finishes with its final places. Runs in
 * the caller's transaction and locks the tournament, so two job runs never both move it.
 */
export async function advanceTournament(
	tx: SQL,
	tournamentId: string,
): Promise<{ round: number; finished: boolean } | null> {
	const [tournament] = await tx`
		SELECT
			t.game_slug,
			t.players_per_room,
			t.format,
			t.rounds,
			g.min_players,
			g.max_players,
			tr.round,
			(SELECT max(r.closed_at) FROM rooms r WHERE r.tournament_id = t.id AND r.tournament_round = tr.round)
				AS last_closed_at
		FROM tournaments t
		JOIN games g ON g.slug = t.game_slug
		JOIN tournament_rounds tr ON tr.tournament_id = t.id
		WHERE t.id = ${tournamentId}
			AND t.cancelled_at IS NULL
			AND t.ended_at IS NULL
			AND tr.ended_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM rooms r
				WHERE r.tournament_id = t.id
					AND r.tournament_round = tr.round
					AND r.closed_at IS NULL
			)
		ORDER BY tr.round DESC
		LIMIT 1
		FOR UPDATE OF t`;

	if (!tournament) {
		return null;
	}

	const round: number = tournament.round;

	// greatest(): a table can close a moment before its start by the actor's clock.
	const [{ ended_at: roundEndedAt }] = await tx`
		UPDATE tournament_rounds
		SET ended_at = greatest(starts_at, ${tournament.last_closed_at ?? null}::timestamptz)
		WHERE tournament_id = ${tournamentId} AND round = ${round}
		RETURNING ended_at`;

	const seats = await roundSeats(tx, tournamentId);
	const playable = await playablePlayers(tx, tournamentId);
	const signUpOrder = await signUpOrderOf(tx, tournamentId);
	const isKnockout = tournament.format === null || tournament.format === "knockout";

	// Who plays next, already in seating order; empty when the tournament is done.
	let next: string[];
	let places: () => FinalPlace[];

	if (isKnockout) {
		const winners = tableWinners(seats, round).filter((playerId) => playable.has(playerId));
		next = winners.length >= 2 ? shuffle(winners) : [];
		const champion = winners.length === 1 ? winners[0]! : null;
		places = () => finalPlaces(seats, signUpOrder, champion);
	} else {
		// Arena and Swiss: everyone who sat down and may still play goes on, until the last round.
		const seated = new Set(seats.map((seat) => seat.playerId));
		const stillIn = [...seated].filter((playerId) => playable.has(playerId));
		const roundsLeft = round < (tournament.rounds ?? DEFAULT_ROUNDS);
		const canFillATable = stillIn.length >= tournament.min_players;

		next = [];
		if (roundsLeft && canFillATable) {
			next =
				tournament.format === "swiss" ? swissOrder(stillIn, seats, signUpOrder) : shuffle(stillIn);
		}
		places = () => pointsPlaces(seats, signUpOrder);
	}

	if (next.length === 0) {
		await finishTournament(tx, tournamentId, places(), roundEndedAt);
		return { round, finished: true };
	}

	const tables = planRoundTables(
		next,
		tournament.players_per_room,
		tournament.min_players,
		tournament.max_players,
	);
	const [{ starts_at: startsAt }] = await tx`SELECT now() + ${ROUND_BREAK}::interval AS starts_at`;

	await seatRound(tx, {
		tournamentId,
		game: tournament.game_slug,
		round: round + 1,
		startsAt,
		tables,
		adminId: null,
	});

	const detail = JSON.stringify({
		round: round + 1,
		rooms: tables.length,
		players: next.length,
		auto: true,
	});
	await tx`
		INSERT INTO admin_audit_events (admin_id, action, tournament_id, detail)
		VALUES (NULL, 'tournament.distribute', ${tournamentId}, ${detail}::text::jsonb)`;

	return { round: round + 1, finished: false };
}

/** Every seat of the tournament with where its player finished; a seat they didn't play has no placement. */
export async function roundSeats(tx: SQL, tournamentId: string): Promise<RoundSeat[]> {
	const rows = await tx`
		SELECT
			ra.player_id,
			ra.tournament_round,
			mp.placement,
			(SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS table_size
		FROM room_assignments ra
		JOIN tournament_players tp
			ON tp.tournament_id = ra.tournament_id AND tp.player_id = ra.player_id
		LEFT JOIN matches m ON m.room_id = ra.room_id
		LEFT JOIN match_players mp ON mp.match_id = m.id AND mp.player_id = ra.player_id
		WHERE ra.tournament_id = ${tournamentId}
			AND tp.status <> 'disqualified'`;

	type Row = {
		player_id: string;
		tournament_round: number;
		placement: number | null;
		table_size: number;
	};

	return rows.map((row: Row) => ({
		playerId: row.player_id,
		round: row.tournament_round,
		placement: row.placement,
		tableSize: row.table_size,
	}));
}

/** Players who may still be seated: registered (not withdrawn or disqualified) and not disabled. */
async function playablePlayers(tx: SQL, tournamentId: string): Promise<Set<string>> {
	const rows = await tx`
		SELECT tp.player_id
		FROM tournament_players tp
		JOIN players p ON p.id = tp.player_id
		WHERE tp.tournament_id = ${tournamentId}
			AND tp.status = 'registered'
			AND p.disabled_at IS NULL`;

	return new Set(rows.map((row: { player_id: string }) => row.player_id));
}

/** Each player's place in the sign-up line, earliest 0: the last tie-break. */
export async function signUpOrderOf(tx: SQL, tournamentId: string): Promise<Map<string, number>> {
	const signUps = await tx`
		SELECT player_id
		FROM tournament_players
		WHERE tournament_id = ${tournamentId}
		ORDER BY created_at, player_id`;

	return new Map<string, number>(
		signUps.map((row: { player_id: string }, index: number) => [row.player_id, index]),
	);
}

/** Writes the final places once and ends the tournament when its last round ended. */
async function finishTournament(
	tx: SQL,
	tournamentId: string,
	places: FinalPlace[],
	endedAt: Date,
): Promise<void> {
	if (places.length > 0) {
		const rows = places.map((place) => ({
			tournament_id: tournamentId,
			player_id: place.playerId,
			place: place.place,
			wins: place.wins,
			points: place.points,
			last_round: place.lastRound,
		}));
		await tx`INSERT INTO tournament_results ${tx(rows)} ON CONFLICT DO NOTHING`;
	}

	await tx`
		UPDATE tournaments
		SET ended_at = greatest(starts_at, ${endedAt})
		WHERE id = ${tournamentId}`;
}

/**
 * Closes a tournament room; the job moves its round on once every table of it closed. A match report (finished,
 * or terminated by an admin) also overrides an earlier "not enough players" (the job closed a room whose start
 * call got lost).
 */
export async function closeRoom(
	tx: SQL,
	roomId: string,
	reason: "finished" | "not_enough_players" | "terminated",
	startedAt?: string,
): Promise<void> {
	const [room] = await tx`
		UPDATE rooms
		SET
			closed_at = now(),
			close_reason = ${reason},
			started_at = coalesce(started_at, ${startedAt ?? null}::timestamptz)
		WHERE id = ${roomId}
			AND tournament_id IS NOT NULL
			AND (
				closed_at IS NULL
				OR (${reason} <> 'not_enough_players' AND close_reason = 'not_enough_players')
			)
		RETURNING tournament_id`;

	if (room) {
		log.debug({ msg: "tournament table closed", roomId, reason });
	}
}

/**
 * One tick of the job: distributes tournaments whose registration closed, and closes rooms nobody opened.
 * SKIP LOCKED keeps overlapping runs (or several platform instances) from doing the same tournament twice.
 */
export async function runTournamentJob(sql: SQL): Promise<{
	distributed: number;
	cancelled: number;
	failed: number;
	closed: number;
	nextRounds: number;
	finished: number;
}> {
	return sql.begin(async (tx) => {
		const due = await tx`
			SELECT id
			FROM tournaments
			WHERE registration_closes_at <= now()
				AND distributed_at IS NULL
				AND cancelled_at IS NULL
			ORDER BY registration_closes_at
			FOR UPDATE SKIP LOCKED
			LIMIT ${JOB_BATCH}`;

		let distributed = 0;
		let cancelled = 0;
		let failed = 0;

		for (const { id } of due) {
			try {
				const shortBy = await tx.savepoint((sp) => cancelIfShort(sp, id));
				if (shortBy) {
					cancelled += 1;
					log.info({ msg: "tournament cancelled", tournamentId: id, ...shortBy });
					continue;
				}

				const result = await tx.savepoint((sp) => distributeIn(sp, id, { adminId: null }));
				distributed += 1;
				log.info({ msg: "tournament distributed", tournamentId: id, ...result });
			} catch (err) {
				failed += 1;
				await saveDistributeError(tx, id, err);
			}
		}

		// A started room is never closed here: its match reaches the platform through the room's outbox.
		const closed = await tx`
			UPDATE rooms r
			SET closed_at = now(), close_reason = 'not_enough_players'
			FROM tournaments t
			JOIN tournament_rounds tr ON tr.tournament_id = t.id
			WHERE t.id = r.tournament_id
				AND tr.round = r.tournament_round
				AND t.cancelled_at IS NULL
				AND r.started_at IS NULL
				AND r.closed_at IS NULL
				AND tr.starts_at + ${UNOPENED_CLOSE_AFTER}::interval <= now()
			RETURNING r.tournament_id`;

		const advanced = await advanceDue(tx);

		return { distributed, cancelled, failed, closed: closed.length, ...advanced };
	});
}

/** Moves on every tournament whose current round has all its tables closed, each in its own savepoint. */
async function advanceDue(tx: TransactionSQL): Promise<{ nextRounds: number; finished: number }> {
	const due = await tx`
		SELECT t.id
		FROM tournaments t
		JOIN tournament_rounds tr ON tr.tournament_id = t.id AND tr.ended_at IS NULL
		WHERE t.cancelled_at IS NULL
			AND t.ended_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM rooms r
				WHERE r.tournament_id = t.id
					AND r.tournament_round = tr.round
					AND r.closed_at IS NULL
			)
		ORDER BY tr.starts_at
		FOR UPDATE OF t SKIP LOCKED
		LIMIT ${JOB_BATCH}`;

	let nextRounds = 0;
	let finished = 0;

	for (const { id } of due) {
		try {
			const moved = await tx.savepoint((sp) => advanceTournament(sp, id));
			if (!moved) {
				continue;
			}

			if (moved.finished) {
				finished += 1;
				log.info({ msg: "tournament finished", tournamentId: id, round: moved.round });
				continue;
			}

			nextRounds += 1;
			log.info({ msg: "tournament round seated", tournamentId: id, round: moved.round });
		} catch (err) {
			log.error({ msg: "tournament round failed to advance", tournamentId: id, err });
		}
	}

	return { nextRounds, finished };
}

/** Shows admins why the job could not distribute. Unknown errors are logged and get a generic message. */
async function saveDistributeError(tx: SQL, tournamentId: string, err: unknown): Promise<void> {
	const known = err instanceof DistributeError;
	if (!known) {
		log.error({ msg: "tournament distribute failed", tournamentId, err });
	}

	const reason = known
		? err.message
		: "Something went wrong. The platform tries again every minute.";

	await tx`
		UPDATE tournaments
		SET distribute_error = ${reason}
		WHERE id = ${tournamentId} AND distribute_error IS DISTINCT FROM ${reason}`;
}

/** Tournaments of a game whose registration is open now, and whether this player is in. */
export async function listOpen(sql: SQL, game: string, playerId: string) {
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
				SELECT count(*)::int FROM tournament_players x
				WHERE x.tournament_id = t.id AND x.status = 'registered'
			) AS registered,
			EXISTS (
				SELECT 1 FROM tournament_players x
				WHERE x.tournament_id = t.id
					AND x.player_id = ${playerId}
					AND x.status = 'registered'
			) AS joined
		FROM tournaments t
		WHERE t.game_slug = ${game}
			AND t.cancelled_at IS NULL
			AND t.distributed_at IS NULL
			AND t.registration_opens_at <= now()
			AND t.registration_closes_at > now()
		ORDER BY t.starts_at
		LIMIT ${LIST_LIMIT}`;

	return rows.map((row: any) => ({
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
	}));
}

/** Signs the player up. Signing up twice is a no-op; a disqualified player can't sign up again. */
export async function joinTournament(sql: SQL, tournamentId: string, playerId: string) {
	await sql.begin(async (tx) => {
		const tournament = await lockTournament(tx, tournamentId);
		requireOpenRegistration(tournament);

		const [signedUp] = await tx`
			SELECT status
			FROM tournament_players
			WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}`;

		if (signedUp?.status === "disqualified") {
			throw new ApiError("forbidden", 403, "You were disqualified from this tournament.");
		}

		if (signedUp?.status === "registered") {
			return;
		}

		await requireFreePlace(tx, tournamentId, tournament.max_players);

		await tx`
			INSERT INTO tournament_players (tournament_id, player_id)
			VALUES (${tournamentId}, ${playerId})
			ON CONFLICT DO NOTHING`;
	});
}

/**
 * Signs the player out. While registration is open, the sign-up is deleted. Once the tables are handed out, the
 * player withdraws: their seat is freed and they can't come back. Refused once their table started; they leave it
 * from the table then. Signing out when not signed up is a no-op.
 */
export async function leaveTournament(sql: SQL, tournamentId: string, playerId: string) {
	await sql.begin(async (tx) => {
		const tournament = await lockTournament(tx, tournamentId);

		if (!tournament.distributed_at) {
			requireOpenRegistration(tournament);

			await tx`
				DELETE FROM tournament_players
				WHERE tournament_id = ${tournamentId}
					AND player_id = ${playerId}
					AND status = 'registered'`;
			return;
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
			LIMIT 1`;

		const playingNow = seat?.started_at && !seat.closed_at;
		if (playingNow) {
			throw new ApiError(
				"conflict",
				409,
				"Your table already started. Leave it from the table instead.",
			);
		}

		if (seat && !seat.started_at) {
			await tx`
				DELETE FROM room_assignments
				WHERE room_id = ${seat.room_id} AND player_id = ${playerId}`;
		}

		await tx`
			UPDATE tournament_players
			SET status = 'withdrawn', status_changed_at = now()
			WHERE tournament_id = ${tournamentId}
				AND player_id = ${playerId}
				AND status = 'registered'`;
	});
}

/**
 * The tournament, refused when missing or cancelled. FOR UPDATE holds the row for the transaction, so a distribute
 * run on the same tournament waits, and two sign-ups can't both take its last place.
 */
async function lockTournament(tx: SQL, tournamentId: string) {
	const [tournament] = await tx`
		SELECT
			cancelled_at,
			distributed_at,
			max_players,
			registration_opens_at <= now() AND registration_closes_at > now() AS open
		FROM tournaments
		WHERE id = ${tournamentId}
		FOR UPDATE`;

	if (!tournament) {
		throw new ApiError("not_found", 404, "There is no such tournament.");
	}

	if (tournament.cancelled_at) {
		throw new ApiError("conflict", 409, "This tournament was cancelled.");
	}

	return tournament as {
		distributed_at: Date | null;
		max_players: number | null;
		open: boolean;
	};
}

/**
 * Refuses a sign-up when the tournament is full; NULL takes anyone. The caller holds the tournament row, so the
 * count can't change under it.
 */
async function requireFreePlace(tx: SQL, tournamentId: string, maxPlayers: number | null) {
	if (maxPlayers === null) {
		return;
	}

	const [{ registered }] = await tx`
		SELECT count(*)::int AS registered
		FROM tournament_players
		WHERE tournament_id = ${tournamentId}
			AND status = 'registered'`;

	if (registered >= maxPlayers) {
		throw new ApiError("conflict", 409, "Sign-up is closed: this tournament is full.");
	}
}

function requireOpenRegistration(tournament: { distributed_at: Date | null; open: boolean }) {
	if (!tournament.open || tournament.distributed_at) {
		throw new ApiError("conflict", 409, "Registration for this tournament is closed.");
	}
}

/** The open tournament tables the player is seated at, so the game's home page can show "your table". */
export async function seatedRooms(sql: SQL, playerId: string, game: string | undefined) {
	const gameFilter = game ? sql`AND r.game_slug = ${game}` : sql``;

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
		LIMIT ${LIST_LIMIT}`;

	return rows.map((row: any) => ({
		code: row.code,
		game: row.game_slug,
		seat: row.seat,
		started: !!row.started_at,
		tournament: {
			id: row.tournament_id,
			name: row.name,
			startsAt: row.starts_at.toISOString(),
		},
	}));
}
