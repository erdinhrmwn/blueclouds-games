import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { playerAuth, type PlayerVariables, serverAuth } from "./auth";
import { ApiError, ok, parse, readJson } from "./http";
import { rateLimit } from "./rate-limit";
import { closeRoom } from "./tournaments";

/** No 0/O or 1/I, so a code read aloud or copied by hand stays right. */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
/**
 * ponytail: 32^5 ≈ 33 million codes and codes are never reused. Past ~1 million rooms collisions
 * get frequent enough to see here; then make CODE_LENGTH 6.
 */
const CODE_TRIES = 5;
/** Players open tables, so it is rate-limited like guest sign-ups, a bit looser. */
const ROOM_LIMIT = { perIp: 20, windowMs: 60_000 };

export function newRoomCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
	return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

const Game = z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.");
const NewRoom = z.object({ game: Game });
const Code = z.string().regex(/^[A-Z0-9]{4,8}$/, "Not a room code.");

export type Room = { id: string; code: string; game: string };

/** Inserts a room with a fresh code, retrying on the rare collision. */
export async function insertRoom(
	sql: SQL,
	room: { game: string; tournamentId?: string; playerId?: string; adminId?: string | null },
): Promise<Room> {
	for (let i = 0; i < CODE_TRIES; i++) {
		const [row] = await sql`
			INSERT INTO rooms (game_slug, code, tournament_id, created_by_player_id, created_by_admin_id)
			VALUES (${room.game}, ${newRoomCode()}, ${room.tournamentId ?? null}, ${room.playerId ?? null}, ${room.adminId ?? null})
			ON CONFLICT (code) DO NOTHING RETURNING id, code, game_slug AS game`;
		if (row) return row as Room;
	}
	throw new Error(`no free room code after ${CODE_TRIES} tries`);
}

const CloseBody = z.object({ reason: z.literal("not_enough_players") });

export function roomRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);
	const server = serverAuth(serverKey);

	/** A player opens a new table: the platform picks its code. */
	app.post("/rooms", rateLimit(ROOM_LIMIT.perIp, ROOM_LIMIT.windowMs), auth, async (c) => {
		const { game } = parse(NewRoom, await readJson(c));
		const [known] = await sql`SELECT 1 FROM games WHERE slug = ${game}`;
		if (!known) throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
		return ok(c, { room: await insertRoom(sql, { game, playerId: c.get("player").id }) }, 201);
	});

	/**
	 * Whether the signed-in player may enter this room. The game's server asks before it hands out a room token.
	 * A tournament room lets in only its assigned players (also after it closed, to see how it ended),
	 * and nobody once its tournament was cancelled.
	 */
	app.get("/rooms/:code", auth, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const [row] = await sql`
			SELECT r.id, r.code, r.game_slug AS game, t.name, t.starts_at, t.cancelled_at,
			       EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id = r.id AND ra.player_id = ${c.get("player").id}) AS assigned
			FROM rooms r LEFT JOIN tournaments t ON t.id = r.tournament_id WHERE r.code = ${code}`;
		if (!row) throw new ApiError("not_found", 404, "There is no table with that code.");
		if (row.name) {
			if (row.cancelled_at) throw new ApiError("forbidden", 403, `${row.name} was cancelled.`);
			if (!row.assigned) throw new ApiError("forbidden", 403, `This table is for players of ${row.name}.`);
		}
		const tournament = row.name ? { name: row.name, startsAt: row.starts_at.toISOString() } : null;
		return ok(c, { room: { id: row.id, code: row.code, game: row.game, tournament } });
	});

	/** For the room actor (server key): its tournament, start time and who sits where. */
	app.get("/rooms/:code/seats", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const [row] = await sql`
			SELECT r.code, r.game_slug AS game, r.started_at, r.closed_at, t.id AS tournament_id, t.name, t.starts_at, t.cancelled_at, g.min_players
			FROM rooms r JOIN games g ON g.slug = r.game_slug LEFT JOIN tournaments t ON t.id = r.tournament_id
			WHERE r.code = ${code}`;
		if (!row) throw new ApiError("not_found", 404, "There is no table with that code.");
		const seats = row.tournament_id
			? await sql`SELECT ra.player_id AS "playerId", ra.seat FROM room_assignments ra JOIN rooms r ON r.id = ra.room_id WHERE r.code = ${code} ORDER BY ra.seat`
			: [];
		const iso = (d: Date | null) => d?.toISOString() ?? null;
		return ok(c, {
			room: {
				code: row.code,
				game: row.game,
				minPlayers: row.min_players,
				startedAt: iso(row.started_at),
				closedAt: iso(row.closed_at),
				tournament: row.tournament_id
					? { id: row.tournament_id, name: row.name, startsAt: iso(row.starts_at), cancelled: !!row.cancelled_at }
					: null,
				seats: [...seats],
			},
		});
	});

	/** The tournament room's match began. Idempotent. */
	app.post("/rooms/:code/start", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const [row] = await sql`
			UPDATE rooms SET started_at = coalesce(started_at, now()) WHERE code = ${code} AND tournament_id IS NOT NULL RETURNING started_at`;
		if (!row) throw new ApiError("not_found", 404, "There is no tournament table with that code.");
		return ok(c, { room: { code, startedAt: row.started_at.toISOString() } });
	});

	/** The tournament room gave up: not enough players showed up. Idempotent. */
	app.post("/rooms/:code/close", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { reason } = parse(CloseBody, await readJson(c));
		await sql.begin(async (tx) => {
			const [room] = await tx`SELECT id FROM rooms WHERE code = ${code} AND tournament_id IS NOT NULL`;
			if (!room) throw new ApiError("not_found", 404, "There is no tournament table with that code.");
			await closeRoom(tx, room.id, reason);
		});
		return ok(c, { room: { code, closed: true } });
	});

	return app;
}
