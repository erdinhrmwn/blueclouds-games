import type { SQL } from "bun";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { z } from "zod";
import { ApiError, ok, validate } from "../lib/http";
import type { Signer } from "../lib/play-tokens";
import { bearer, playerAuth, serverAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import * as players from "../services/players";

/** Same rule as the room's display name: trimmed, 1–20 characters. */
const Name = z
	.string()
	.trim()
	.min(1, "Must be 1–20 characters.")
	.max(20, "Must be 1–20 characters.")
	// Same rule as players_display_name_check.
	.refine((name) => !/\p{Cc}/u.test(name), "Must not contain control characters.");

const NameBody = z.object({ name: Name });

/** A room asks about its seated humans only: at most a few ids. */
const MAX_VIP_LOOKUP = 12;
const VipQuery = z.object({
	ids: z
		.string()
		.transform((ids) => ids.split(","))
		.pipe(z.array(z.uuid()).min(1).max(MAX_VIP_LOOKUP)),
});
/** A guest may bring a name (a browser that lost its guest keeps playing under the same name); else one is made up. */
const GuestBody = z.object({ name: Name.optional() });

/** Same rule as players_username_check; stored lowercase so "Ann" and "ann" are one account. */
const Username = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^[a-z0-9_.-]{3,32}$/, "Use 3–32 characters: a–z, 0–9, _ . -")
	.refine(
		(username) => !username.startsWith("guest"),
		'Usernames starting with "guest" are kept for guests.',
	);
/** Long enough to resist guessing; capped so hashing stays cheap for the server. */

const Password = z
	.string()
	.min(8, "Use at least 8 characters.")
	.max(200, "Use at most 200 characters.");

const Register = z.object({ name: Name, username: Username, password: Password });
const PasswordChange = z.object({
	currentPassword: z.string().min(1).max(200),
	newPassword: Password,
});
const Login = z.object({
	username: z.string().trim().toLowerCase().max(64),
	password: z.string().max(200),
});

const GUEST_LIMIT = { perIp: 5, windowMs: 60_000 };
const LOGIN_LIMIT = { perIp: 10, windowMs: 60_000 };

export function playerRoutes(sql: SQL, signer: Signer, serverKey: string) {
	const app = new Hono<AppEnv>();
	const auth = playerAuth(sql);
	const server = serverAuth(serverKey);

	/** New guest player. The secret is returned only here. */
	app.post(
		"/players/guest",
		rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs),
		validate("json", GuestBody),
		async (c) => {
			const { name } = c.req.valid("json");
			const signedIn = await players.createGuest(sql, name);

			return ok(c, signedIn, 201);
		},
	);

	/** With the current guest's secret, that guest becomes the account; without one, a new player is made (201). */
	app.post(
		"/players/register",
		rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs),
		validate("json", Register),
		async (c) => {
			const input = c.req.valid("json");
			const current = await players.findBySecret(sql, bearer(c.req.header("authorization")));
			const result = await players.register(sql, current, input);
			const status = result.playerSecret ? 201 : 200;

			return ok(c, result, status);
		},
	);

	app.post(
		"/players/login",
		rateLimit(LOGIN_LIMIT.perIp, LOGIN_LIMIT.windowMs),
		validate("json", Login),
		async (c) => {
			const { username, password } = c.req.valid("json");
			const signedIn = await players.login(sql, username, password);

			return ok(c, signedIn);
		},
	);

	app.post("/players/logout", auth, async (c) => {
		await players.logout(sql, c.get("player"), c.get("playerSecret"));

		return ok(c, { signedOut: true });
	});

	/** The game asks on every page load; that counts as being seen. */
	app.get("/players/me", auth, async (c) => {
		const player = c.get("player");
		await players.noteSeen(sql, player.id);

		return ok(c, { player });
	});

	/** Accounts only. Signs out every other device; this one stays signed in. */
	app.put("/players/me/password", auth, validate("json", PasswordChange), async (c) => {
		await players.changePassword(sql, c.get("player"), c.get("playerSecret"), c.req.valid("json"));

		return ok(c, { changed: true });
	});

	/** Accounts only: a guest keeps its generated name until it links an account. */
	app.patch("/players/me", auth, validate("json", NameBody), async (c) => {
		const player = c.get("player");
		if (player.guest) {
			throw new ApiError("forbidden", 403, "Link an account to choose your name.");
		}

		const { name } = c.req.valid("json");
		const renamed = await players.rename(sql, player.id, name);

		return ok(c, { player: renamed });
	});

	app.post("/play-tokens", auth, async (c) => {
		const playToken = await players.issuePlayToken(sql, signer, c.get("player"));

		return ok(c, playToken);
	});

	/** For the room actor, with the server key: which of its seated players are VIP right now. */
	app.get("/players/vips", server, validate("query", VipQuery), async (c) => {
		const { ids } = c.req.valid("query");
		const vipIds = await players.vipIds(sql, ids);

		return ok(c, { vipIds });
	});

	return app;
}
