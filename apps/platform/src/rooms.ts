import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { playerAuth, type PlayerVariables } from "./auth";
import { ApiError, ok, parse, readJson } from "./http";
import { rateLimit } from "./rate-limit";

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

/** The room with this code, or null. */
export async function findRoom(sql: SQL, code: string): Promise<Room | null> {
	const [row] = await sql`SELECT id, code, game_slug AS game FROM rooms WHERE code = ${code}`;
	return (row as Room | undefined) ?? null;
}

export function roomRoutes(sql: SQL) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);

	/** A player opens a new table: the platform picks its code. */
	app.post("/rooms", rateLimit(ROOM_LIMIT.perIp, ROOM_LIMIT.windowMs), auth, async (c) => {
		const { game } = parse(NewRoom, await readJson(c));
		const [known] = await sql`SELECT 1 FROM games WHERE slug = ${game}`;
		if (!known) throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
		for (let i = 0; i < CODE_TRIES; i++) {
			const [row] = await sql`
				INSERT INTO rooms (game_slug, code, created_by_player_id) VALUES (${game}, ${newRoomCode()}, ${c.get("player").id})
				ON CONFLICT (code) DO NOTHING RETURNING id, code, game_slug AS game`;
			if (row) return ok(c, { room: row as Room }, 201);
		}
		throw new Error(`no free room code after ${CODE_TRIES} tries`);
	});

	/** Whether the signed-in player may enter this room. The game's server asks before it hands out a room token. */
	app.get("/rooms/:code", auth, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const room = await findRoom(sql, code);
		if (!room) throw new ApiError("not_found", 404, "There is no table with that code.");
		return ok(c, { room });
	});

	return app;
}
