import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { playerAuth, type PlayerVariables } from "./auth";
import { ApiError, ok, parse } from "./http";
import { log } from "./log";
import { insertRoom } from "./rooms";

/** How often the job distributes due tournaments and closes rooms nobody opened. */
export const JOB_EVERY_MS = 30_000;
const JOB_BATCH = 10;
/**
 * A room nobody opened is closed this long after starts_at: the room's own 3-minute wait for late
 * players (LATE_GRACE_MS in the actor) plus a margin.
 */
const UNOPENED_CLOSE_AFTER = "4 minutes";

/** Why a tournament can't be distributed; the message is shown to admins as is. */
export class DistributeError extends Error {}

/**
 * Splits players into ceil(n / perRoom) rooms, as evenly as possible (20 at 6 → 5+5+5+5).
 * Refuses when a room would fall below the game's minimum, and says how to fix it.
 */
export function planRooms<T>(players: T[], perRoom: number, minPlayers: number): T[][] {
	const n = players.length;
	if (n === 0) throw new DistributeError("Nobody is registered.");
	if (perRoom < minPlayers) throw new DistributeError(`Players per table must be at least ${minPlayers}.`);
	const rooms = Math.ceil(n / perRoom);
	const base = Math.floor(n / rooms);
	if (base < minPlayers) {
		const add = rooms * minPlayers - n;
		const remove = rooms > 1 ? n - (rooms - 1) * perRoom : 0;
		const fix = `Add ${add} player${add === 1 ? "" : "s"}${remove ? ` or remove ${remove}` : ""}.`;
		throw new DistributeError(`${n} player${n === 1 ? "" : "s"} can't fill every table with at least ${minPlayers}. ${fix}`);
	}
	const extra = n % rooms;
	const out: T[][] = [];
	for (let r = 0, i = 0; r < rooms; r++) {
		const size = base + (r < extra ? 1 : 0);
		out.push(players.slice(i, i + size));
		i += size;
	}
	return out;
}

function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	const random = crypto.getRandomValues(new Uint32Array(out.length));
	for (let i = out.length - 1; i > 0; i--) {
		const j = random[i]! % (i + 1);
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

export type DistributeBy = { adminId: string | null; ip?: string | null };

/**
 * Opens the tournament's rooms and seats every registered player, inside the caller's transaction.
 * Locks the tournament row first, so two runs (job and "Distribute now") never both distribute.
 */
export async function distributeIn(tx: SQL, tournamentId: string, by: DistributeBy): Promise<{ rooms: number; players: number }> {
	const [t] = await tx`
		SELECT t.game_slug, t.players_per_room, t.distributed_at, t.cancelled_at, g.min_players
		FROM tournaments t JOIN games g ON g.slug = t.game_slug WHERE t.id = ${tournamentId} FOR UPDATE OF t`;
	if (!t) throw new DistributeError("Tournament not found.");
	if (t.cancelled_at) throw new DistributeError("This tournament was cancelled.");
	if (t.distributed_at) throw new DistributeError("Players already have their tables.");
	// Disabled players can't play, so they don't take a seat.
	const registered = await tx`
		SELECT tp.player_id FROM tournament_players tp JOIN players p ON p.id = tp.player_id
		WHERE tp.tournament_id = ${tournamentId} AND p.disabled_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.tournament_id = tp.tournament_id AND ra.player_id = tp.player_id)`;
	const plan = planRooms(shuffle(registered.map((r: { player_id: string }) => r.player_id)), t.players_per_room, t.min_players);
	for (const players of plan) {
		const room = await insertRoom(tx, { game: t.game_slug, tournamentId, adminId: by.adminId });
		const rows = players.map((playerId, seat) => ({ room_id: room.id, tournament_id: tournamentId, player_id: playerId, seat }));
		await tx`INSERT INTO room_assignments ${tx(rows)}`;
	}
	await tx`UPDATE tournaments SET distributed_at = now(), distribute_error = NULL WHERE id = ${tournamentId}`;
	const result = { rooms: plan.length, players: registered.length };
	await tx`
		INSERT INTO admin_audit_events (admin_id, action, tournament_id, detail, ip)
		VALUES (${by.adminId}, 'tournament.distribute', ${tournamentId}, ${JSON.stringify({ ...result, auto: !by.adminId })}::text::jsonb, ${by.ip ?? null}::inet)`;
	return result;
}

/** Sets ended_at on each of these tournaments whose rooms are all closed: when the last one closed. */
export async function endIfDone(tx: SQL, tournamentIds: string[]): Promise<void> {
	const ids = [...new Set(tournamentIds)];
	if (!ids.length) return;
	// greatest(): a room can close a moment before starts_at by the actor's clock.
	await tx`
		UPDATE tournaments t SET ended_at = greatest(t.starts_at, (SELECT max(r.closed_at) FROM rooms r WHERE r.tournament_id = t.id))
		WHERE t.id IN ${tx(ids)} AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.tournament_id = t.id AND r.closed_at IS NULL)`;
}

/**
 * Closes a tournament room, and its tournament if it was the last open room. A finished match also
 * overrides an earlier "not enough players" (the job closed a room whose start call got lost).
 */
export async function closeRoom(tx: SQL, roomId: string, reason: "finished" | "not_enough_players", startedAt?: string): Promise<void> {
	const [room] = await tx`
		UPDATE rooms SET closed_at = now(), close_reason = ${reason}, started_at = coalesce(started_at, ${startedAt ?? null}::timestamptz)
		WHERE id = ${roomId} AND tournament_id IS NOT NULL
		  AND (closed_at IS NULL OR (${reason} = 'finished' AND close_reason <> 'finished'))
		RETURNING tournament_id`;
	if (room) await endIfDone(tx, [room.tournament_id]);
}

/**
 * One tick of the job: distributes tournaments whose registration closed, and closes rooms nobody opened.
 * SKIP LOCKED keeps overlapping runs (or several platform instances) from doing the same tournament twice.
 */
export async function runTournamentJob(sql: SQL): Promise<{ distributed: number; failed: number; closed: number }> {
	return sql.begin(async (tx) => {
		const due = await tx`
			SELECT id FROM tournaments
			WHERE registration_closes_at <= now() AND distributed_at IS NULL AND cancelled_at IS NULL
			ORDER BY registration_closes_at FOR UPDATE SKIP LOCKED LIMIT ${JOB_BATCH}`;
		let distributed = 0;
		let failed = 0;
		for (const { id } of due) {
			try {
				const result = await tx.savepoint((sp) => distributeIn(sp, id, { adminId: null }));
				distributed++;
				log.info({ msg: "tournament distributed", tournamentId: id, ...result });
			} catch (err) {
				failed++;
				const known = err instanceof DistributeError;
				if (!known) log.error({ msg: "tournament distribute failed", tournamentId: id, err: String(err) });
				const reason = known ? err.message : "Something went wrong. The platform tries again every 30 seconds.";
				await tx`UPDATE tournaments SET distribute_error = ${reason} WHERE id = ${id} AND distribute_error IS DISTINCT FROM ${reason}`;
			}
		}
		// A started room is never closed here: its match reaches the platform through the room's outbox.
		const closed = await tx`
			UPDATE rooms r SET closed_at = now(), close_reason = 'not_enough_players'
			FROM tournaments t
			WHERE t.id = r.tournament_id AND t.cancelled_at IS NULL AND r.started_at IS NULL AND r.closed_at IS NULL
			  AND t.starts_at + ${UNOPENED_CLOSE_AFTER}::interval <= now()
			RETURNING r.tournament_id`;
		await endIfDone(
			tx,
			closed.map((r: { tournament_id: string }) => r.tournament_id),
		);
		return { distributed, failed, closed: closed.length };
	});
}

/**
 * Runs the job every JOB_EVERY_MS in this process; no cron needed.
 * ponytail: an in-process loop fits one VPS. SKIP LOCKED keeps it safe with more instances; only a far
 * larger number of jobs would call for a real queue.
 */
export function startTournamentJob(sql: SQL): { stop: () => Promise<void> } {
	let running: Promise<unknown> | null = null;
	const tick = () => {
		if (running) return; // the last tick is still busy
		running = runTournamentJob(sql)
			.then((r) => r.distributed + r.failed + r.closed > 0 && log.info({ msg: "tournament job", ...r }))
			.catch((err) => log.error({ msg: "tournament job failed", err: String(err) }))
			.finally(() => (running = null));
	};
	const timer = setInterval(tick, JOB_EVERY_MS);
	tick();
	return {
		stop: async () => {
			clearInterval(timer);
			await running;
		},
	};
}

const GameQuery = z.object({ game: z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.") });
const OptionalGame = z.object({ game: GameQuery.shape.game.optional() });
const Id = z.uuid("Not a tournament id.");
const LIST_LIMIT = 20;

export function tournamentRoutes(sql: SQL) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);

	/** Tournaments of a game whose registration is open now, and whether the signed-in player is in. */
	app.get("/tournaments", auth, async (c) => {
		const { game } = parse(GameQuery, c.req.query());
		const me = c.get("player").id;
		const rows = await sql`
			SELECT t.id, t.name, t.starts_at, t.registration_closes_at, t.players_per_room,
			       (SELECT count(*)::int FROM tournament_players x WHERE x.tournament_id = t.id) AS registered,
			       EXISTS (SELECT 1 FROM tournament_players x WHERE x.tournament_id = t.id AND x.player_id = ${me}) AS joined
			FROM tournaments t
			WHERE t.game_slug = ${game} AND t.cancelled_at IS NULL AND t.distributed_at IS NULL
			  AND t.registration_opens_at <= now() AND t.registration_closes_at > now()
			ORDER BY t.starts_at LIMIT ${LIST_LIMIT}`;
		return ok(c, {
			tournaments: rows.map((r: any) => ({
				id: r.id,
				name: r.name,
				startsAt: r.starts_at.toISOString(),
				registrationClosesAt: r.registration_closes_at.toISOString(),
				playersPerRoom: r.players_per_room,
				registered: r.registered,
				joined: r.joined,
			})),
		});
	});

	/** Signs the player up (or out). FOR SHARE waits for a distribute run on the same tournament. */
	const register = (join: boolean) =>
		app[join ? "post" : "delete"]("/tournaments/:id/registration", auth, async (c) => {
			const id = parse(Id, c.req.param("id"));
			const me = c.get("player").id;
			await sql.begin(async (tx) => {
				const [t] = await tx`
					SELECT cancelled_at, distributed_at, registration_opens_at <= now() AND registration_closes_at > now() AS open
					FROM tournaments WHERE id = ${id} FOR SHARE`;
				if (!t) throw new ApiError("not_found", 404, "There is no such tournament.");
				if (t.cancelled_at) throw new ApiError("conflict", 409, "This tournament was cancelled.");
				if (!t.open || t.distributed_at) throw new ApiError("conflict", 409, "Registration for this tournament is closed.");
				if (join) await tx`INSERT INTO tournament_players (tournament_id, player_id) VALUES (${id}, ${me}) ON CONFLICT DO NOTHING`;
				else await tx`DELETE FROM tournament_players WHERE tournament_id = ${id} AND player_id = ${me}`;
			});
			return ok(c, { registered: join });
		});
	register(true);
	register(false);

	/** The tournament tables the player is seated at, so the game's home page can show "your table". */
	app.get("/players/me/rooms", auth, async (c) => {
		const { game } = parse(OptionalGame, c.req.query());
		const rows = await sql`
			SELECT r.code, r.game_slug, ra.seat, t.id AS tournament_id, t.name, t.starts_at
			FROM room_assignments ra JOIN rooms r ON r.id = ra.room_id JOIN tournaments t ON t.id = ra.tournament_id
			WHERE ra.player_id = ${c.get("player").id} AND r.closed_at IS NULL AND t.cancelled_at IS NULL
			  ${game ? sql`AND r.game_slug = ${game}` : sql``}
			ORDER BY t.starts_at LIMIT ${LIST_LIMIT}`;
		return ok(c, {
			rooms: rows.map((r: any) => ({
				code: r.code,
				game: r.game_slug,
				seat: r.seat,
				tournament: { id: r.tournament_id, name: r.name, startsAt: r.starts_at.toISOString() },
			})),
		});
	});

	return app;
}
