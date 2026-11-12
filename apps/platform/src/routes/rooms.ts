import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { ok, parse, readJson } from "../lib/http";
import { playerAuth, type PlayerVariables, serverAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import * as rooms from "../services/rooms";

/** Players open tables, so it is rate-limited like guest sign-ups, a bit looser. */
const ROOM_LIMIT = { perIp: 20, windowMs: 60_000 };
/** Making and redeeming invites, per IP. Redeeming is the tight one: it is where a code could be guessed. */
const INVITE_LIMIT = { perIp: 20, windowMs: 60_000 };
const REDEEM_LIMIT = { perIp: 10, windowMs: 60_000 };

const Game = z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.");
const Visibility = z.enum(["public", "private"]);
const NewRoom = z.object({ game: Game, visibility: Visibility.default("private") });
const Code = z.string().regex(/^[A-Z0-9]{4,8}$/, "Not a room code.");
const NewInvite = z.object({ kind: z.enum(["link", "code"]) });
const Redeem = z.object({ invite: z.string().trim().regex(/^[A-Za-z0-9]{6,64}$/, "That invite doesn't look right.") });
const CloseBody = z.object({ reason: z.literal("not_enough_players") });

export function roomRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);
	const server = serverAuth(serverKey);

	app.post("/rooms", rateLimit(ROOM_LIMIT.perIp, ROOM_LIMIT.windowMs), auth, async (c) => {
		const { game, visibility } = parse(NewRoom, await readJson(c));
		return ok(c, { room: await rooms.openRoom(sql, game, visibility, c.get("player").id) }, 201);
	});

	/** Whether the signed-in player may enter this room. The game's server asks before it hands out a room token. */
	app.get("/rooms/:code", auth, async (c) => {
		const { opener: _, ...room } = await rooms.enterable(sql, parse(Code, c.req.param("code")), c.get("player").id);
		return ok(c, { room });
	});

	/** 200 with the room's live link, 201 with a new code. */
	app.post("/rooms/:code/invites", rateLimit(INVITE_LIMIT.perIp, INVITE_LIMIT.windowMs), auth, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { kind } = parse(NewInvite, await readJson(c));
		const invite = await rooms.createInvite(sql, code, c.get("player").id, kind);
		return ok(c, { invite }, kind === "link" ? 200 : 201);
	});

	app.delete("/rooms/:code/invites/link", auth, async (c) => {
		await rooms.resetInviteLink(sql, parse(Code, c.req.param("code")), c.get("player").id);
		return ok(c, { revoked: true });
	});

	app.post("/invites/redeem", rateLimit(REDEEM_LIMIT.perIp, REDEEM_LIMIT.windowMs), auth, async (c) => {
		const { invite } = parse(Redeem, await readJson(c));
		return ok(c, { room: await rooms.redeemInvite(sql, invite, c.get("player").id) });
	});

	// For the room actor, with the server key.

	app.get("/rooms/:code/seats", server, async (c) => {
		return ok(c, { room: await rooms.roomSeats(sql, parse(Code, c.req.param("code"))) });
	});

	app.post("/rooms/:code/start", server, async (c) => {
		return ok(c, { room: await rooms.startRoom(sql, parse(Code, c.req.param("code"))) });
	});

	app.post("/rooms/:code/close", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { reason } = parse(CloseBody, await readJson(c));
		await rooms.closeTournamentRoom(sql, code, reason);
		return ok(c, { room: { code, closed: true } });
	});

	return app;
}
