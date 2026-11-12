import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { ok, parse, readJson } from "../lib/http";
import { playerAuth, type PlayerVariables, serverAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import * as rooms from "../services/rooms";

/** Players open tables, so it is rate-limited like guest sign-ups, a bit looser. */
const ROOM_LIMIT = { perIp: 20, windowMs: 60_000 };

/** Asking for and redeeming invite links, per IP. Redeeming is the tight one: it is where a link is tried. */
const INVITE_LIMIT = { perIp: 20, windowMs: 60_000 };
const REDEEM_LIMIT = { perIp: 10, windowMs: 60_000 };

const Game = z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.");
const Visibility = z.enum(["public", "private"]);
const Code = z.string().regex(/^[A-Z0-9]{4,8}$/, "Not a room code.");

const NewRoom = z.object({ game: Game, visibility: Visibility.default("private") });
const Redeem = z.object({
	invite: z
		.string()
		.trim()
		.regex(/^[0-9a-f]{32}$/, "That invite link doesn't look right."),
});
const CloseBody = z.object({ reason: z.literal("not_enough_players") });

export function roomRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);
	const server = serverAuth(serverKey);

	app.post("/rooms", rateLimit(ROOM_LIMIT.perIp, ROOM_LIMIT.windowMs), auth, async (c) => {
		const { game, visibility } = parse(NewRoom, await readJson(c));
		const room = await rooms.openRoom(sql, game, visibility, c.get("player").id);

		return ok(c, { room }, 201);
	});

	/** Whether the signed-in player may enter this room. The game's server asks before it hands out a room token. */
	app.get("/rooms/:code", auth, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { opener: _, ...room } = await rooms.enterable(sql, code, c.get("player").id);

		return ok(c, { room });
	});

	/** The room's live invite link, made on first ask. */
	app.post(
		"/rooms/:code/invites",
		rateLimit(INVITE_LIMIT.perIp, INVITE_LIMIT.windowMs),
		auth,
		async (c) => {
			const code = parse(Code, c.req.param("code"));
			const invite = await rooms.createInvite(sql, code, c.get("player").id);

			return ok(c, { invite });
		},
	);

	app.delete("/rooms/:code/invites/link", auth, async (c) => {
		const code = parse(Code, c.req.param("code"));
		await rooms.resetInviteLink(sql, code, c.get("player").id);

		return ok(c, { revoked: true });
	});

	app.post(
		"/invites/redeem",
		rateLimit(REDEEM_LIMIT.perIp, REDEEM_LIMIT.windowMs),
		auth,
		async (c) => {
			const { invite } = parse(Redeem, await readJson(c));
			const room = await rooms.redeemInvite(sql, invite, c.get("player").id);

			return ok(c, { room });
		},
	);

	// For the room actor, with the server key.

	app.get("/rooms/:code/seats", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const room = await rooms.roomSeats(sql, code);

		return ok(c, { room });
	});

	app.post("/rooms/:code/start", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const room = await rooms.startRoom(sql, code);

		return ok(c, { room });
	});

	app.post("/rooms/:code/close", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { reason } = parse(CloseBody, await readJson(c));
		await rooms.closeTournamentRoom(sql, code, reason);

		return ok(c, { room: { code, closed: true } });
	});

	return app;
}
