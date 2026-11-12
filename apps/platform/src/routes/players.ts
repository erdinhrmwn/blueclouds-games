import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError, ok, parse, readJson } from "../lib/http";
import type { Signer } from "../lib/play-tokens";
import { bearer, playerAuth, type PlayerVariables } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import * as players from "../services/players";

/** Same rule as the room's display name: trimmed, 1–20 characters. */
const Name = z
	.string()
	.trim()
	.min(1, "Must be 1–20 characters.")
	.max(20, "Must be 1–20 characters.")
	.refine((n) => !/\p{Cc}/u.test(n), "Must not contain control characters."); // same rule as players_display_name_check
const NameBody = z.object({ name: Name });
/** A guest may bring a name (a browser that lost its guest keeps playing under the same name); else one is made up. */
const GuestBody = z.object({ name: Name.optional() });

/** Same rule as players_username_check; stored lowercase so "Ann" and "ann" are one account. */
const Username = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^[a-z0-9_.-]{3,32}$/, "Use 3–32 characters: a–z, 0–9, _ . -")
	.refine((u) => !u.startsWith("guest"), 'Usernames starting with "guest" are kept for guests.');
/** Long enough to resist guessing; capped so hashing stays cheap for the server. */
const Password = z.string().min(8, "Use at least 8 characters.").max(200, "Use at most 200 characters.");
const Register = z.object({ name: Name, username: Username, password: Password });
const Login = z.object({ username: z.string().trim().toLowerCase().max(64), password: z.string().max(200) });

const GUEST_LIMIT = { perIp: 5, windowMs: 60_000 };
const LOGIN_LIMIT = { perIp: 10, windowMs: 60_000 };

export function playerRoutes(sql: SQL, signer: Signer) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);

	/** New guest player. The secret is returned only here. */
	app.post("/players/guest", rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs), async (c) => {
		const { name } = parse(GuestBody, await readJson(c));
		return ok(c, await players.createGuest(sql, name), 201);
	});

	/** With the current guest's secret, that guest becomes the account; without one, a new player is made (201). */
	app.post("/players/register", rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs), async (c) => {
		const input = parse(Register, await readJson(c));
		const current = await players.findBySecret(sql, bearer(c.req.header("authorization")));
		const result = await players.register(sql, current, input);
		return ok(c, result, result.playerSecret ? 201 : 200);
	});

	app.post("/players/login", rateLimit(LOGIN_LIMIT.perIp, LOGIN_LIMIT.windowMs), async (c) => {
		const { username, password } = parse(Login, await readJson(c));
		return ok(c, await players.login(sql, username, password));
	});

	app.post("/players/logout", auth, async (c) => {
		await players.logout(sql, c.get("player"), bearer(c.req.header("authorization"))!);
		return ok(c, { signedOut: true });
	});

	/** The game asks on every page load; that counts as being seen. */
	app.get("/players/me", auth, async (c) => {
		const player = c.get("player");
		await players.noteSeen(sql, player.id);
		return ok(c, { player });
	});

	/** Accounts only: a guest keeps its generated name until it links an account. */
	app.patch("/players/me", auth, async (c) => {
		const player = c.get("player");
		if (player.guest) throw new ApiError("forbidden", 403, "Link an account to choose your name.");
		const { name } = parse(NameBody, await readJson(c));
		return ok(c, { player: await players.rename(sql, player.id, name) });
	});

	app.post("/play-tokens", auth, async (c) => ok(c, await players.issuePlayToken(sql, signer, c.get("player"))));

	return app;
}
