import type { SQL } from "bun";
import { ApiError } from "../lib/http";
import { log } from "../lib/log";
import { insertRoom } from "./rooms";

const JOB_BATCH = 10;

/**
 * A room nobody opened is closed this long after starts_at: the room's own 3-minute wait for late
 * players (LATE_GRACE_MS in the actor) plus a margin.
 */
const UNOPENED_CLOSE_AFTER = "4 minutes";

const LIST_LIMIT = 20;

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
		SELECT t.game_slug, t.players_per_room, t.distributed_at, t.cancelled_at, g.min_players
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
	const plan = planRooms(shuffle(playerIds), tournament.players_per_room, tournament.min_players);

	for (const roomPlayers of plan) {
		const room = await insertRoom(tx, {
			game: tournament.game_slug,
			tournamentId,
			adminId: by.adminId,
		});

		const assignments = roomPlayers.map((playerId, seat) => ({
			room_id: room.id,
			tournament_id: tournamentId,
			player_id: playerId,
			seat,
		}));
		await tx`INSERT INTO room_assignments ${tx(assignments)}`;
	}

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

/** Sets ended_at on each of these tournaments whose rooms are all closed: when the last one closed. */
export async function endIfDone(tx: SQL, tournamentIds: string[]): Promise<void> {
	const ids = [...new Set(tournamentIds)];
	if (ids.length === 0) return;

	// greatest(): a room can close a moment before starts_at by the actor's clock.
	await tx`
		UPDATE tournaments t
		SET ended_at = greatest(
			t.starts_at,
			(SELECT max(r.closed_at) FROM rooms r WHERE r.tournament_id = t.id)
		)
		WHERE t.id IN ${tx(ids)}
			AND NOT EXISTS (
				SELECT 1 FROM rooms r
				WHERE r.tournament_id = t.id AND r.closed_at IS NULL
			)`;
}

/**
 * Closes a tournament room, and its tournament if it was the last open room. A match report (finished, or
 * terminated by an admin) also overrides an earlier "not enough players" (the job closed a room whose start call
 * got lost).
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
		await endIfDone(tx, [room.tournament_id]);
	}
}

/**
 * One tick of the job: distributes tournaments whose registration closed, and closes rooms nobody opened.
 * SKIP LOCKED keeps overlapping runs (or several platform instances) from doing the same tournament twice.
 */
export async function runTournamentJob(
	sql: SQL,
): Promise<{ distributed: number; failed: number; closed: number }> {
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
		let failed = 0;

		for (const { id } of due) {
			try {
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
			WHERE t.id = r.tournament_id
				AND t.cancelled_at IS NULL
				AND r.started_at IS NULL
				AND r.closed_at IS NULL
				AND t.starts_at + ${UNOPENED_CLOSE_AFTER}::interval <= now()
			RETURNING r.tournament_id`;

		const closedTournamentIds = closed.map((row: { tournament_id: string }) => row.tournament_id);
		await endIfDone(tx, closedTournamentIds);

		return { distributed, failed, closed: closed.length };
	});
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

		const [seat] = await tx`
			SELECT r.started_at, r.closed_at
			FROM room_assignments ra
			JOIN rooms r ON r.id = ra.room_id
			JOIN tournament_players tp
				ON tp.tournament_id = ra.tournament_id AND tp.player_id = ra.player_id
			WHERE ra.tournament_id = ${tournamentId}
				AND ra.player_id = ${playerId}
				AND tp.status = 'registered'`;

		if (seat?.started_at || seat?.closed_at) {
			throw new ApiError(
				"conflict",
				409,
				"Your table already started. Leave it from the table instead.",
			);
		}

		await tx`
			DELETE FROM room_assignments
			WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}`;

		await tx`
			UPDATE tournament_players
			SET status = 'withdrawn', status_changed_at = now()
			WHERE tournament_id = ${tournamentId}
				AND player_id = ${playerId}
				AND status = 'registered'`;
	});
}

/**
 * The tournament, refused when missing or cancelled. FOR SHARE holds the row for the transaction, so a distribute
 * run on the same tournament waits.
 */
async function lockTournament(tx: SQL, tournamentId: string) {
	const [tournament] = await tx`
		SELECT
			cancelled_at,
			distributed_at,
			registration_opens_at <= now() AND registration_closes_at > now() AS open
		FROM tournaments
		WHERE id = ${tournamentId}
		FOR SHARE`;

	if (!tournament) {
		throw new ApiError("not_found", 404, "There is no such tournament.");
	}

	if (tournament.cancelled_at) {
		throw new ApiError("conflict", 409, "This tournament was cancelled.");
	}

	return tournament as { distributed_at: Date | null; open: boolean };
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
