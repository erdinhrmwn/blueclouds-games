import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { bearer, hashSecret, newSecret, playerAuth, playerFromHeader, type PlayerRow, type PlayerVariables, toPlayer } from "./auth";
import { ApiError, ok, parse, readJson } from "./http";
import { rateLimit } from "./rate-limit";
import type { Signer } from "./tokens";

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
/** 5 wrong passwords for one username within 15 minutes lock it for the rest of that window, like admin sign-in. */
const LOCKOUT = { tries: 5, windowMs: 15 * 60_000 };
const RETURNING = (sql: SQL) => sql`RETURNING id, display_name, username, is_guest, created_at, disabled_at`;
/** Tries before giving up on a free guest number (6 digits: a clash is rare, a few in a row means something else). */
const GUEST_NUMBER_TRIES = 5;
const guestNumber = () => String(100_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900_000));

/**
 * Wrong passwords per username.
 * ponytail: counted in this process, like rateLimit. With more platform instances, move it to DragonflyDB.
 */
const failures = new Map<string, { count: number; resetAt: number }>();
function isLocked(username: string): boolean {
	const f = failures.get(username);
	return !!f && f.resetAt > Date.now() && f.count >= LOCKOUT.tries;
}
function noteFailure(username: string): void {
	const now = Date.now();
	if (failures.size > 10_000) for (const [k, f] of failures) if (f.resetAt <= now) failures.delete(k);
	const f = failures.get(username);
	if (!f || f.resetAt <= now) failures.set(username, { count: 1, resetAt: now + LOCKOUT.windowMs });
	else f.count++;
}

/** Same work for an unknown username as for a wrong password, so timing doesn't reveal which usernames exist. */
let dummyHash: Promise<string> | undefined;

const isUniqueViolation = (err: unknown) => (err as { errno?: string })?.errno === "23505";

export function playerRoutes(sql: SQL, signer: Signer) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);

	/** New guest player, named "Guest 482193" with username "guest_482193". The secret is returned only here. */
	app.post("/players/guest", rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs), async (c) => {
		const { name } = parse(GuestBody, await readJson(c));
		const secret = newSecret();
		for (let i = 0; i < GUEST_NUMBER_TRIES; i++) {
			const n = guestNumber();
			try {
				const row = await sql.begin(async (tx) => {
					const [p] = await tx`INSERT INTO players (display_name, username) VALUES (${name ?? `Guest ${n}`}, ${`guest_${n}`}) ${RETURNING(tx)}`;
					await tx`INSERT INTO player_secrets (secret_hash, player_id) VALUES (${hashSecret(secret)}, ${p.id})`;
					return p;
				});
				return ok(c, { player: toPlayer(row), playerSecret: secret }, 201);
			} catch (err) {
				if (!isUniqueViolation(err)) throw err; // that number is taken: draw another
			}
		}
		throw new ApiError("internal", 500, "Could not make a guest right now. Try again.");
	});

	/**
	 * Registers a username and password. With the current guest's secret, that guest becomes the account (history
	 * and secret stay); without one, a new player is made and its secret returned.
	 */
	app.post("/players/register", rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs), async (c) => {
		const { name, username, password } = parse(Register, await readJson(c));
		const current = await playerFromHeader(sql, c.req.header("authorization"));
		if (current && !current.is_guest) throw new ApiError("conflict", 409, "You already have an account. Log out first.");
		const passwordHash = await Bun.password.hash(password); // argon2id
		try {
			if (current) {
				const [row] = await sql`
					UPDATE players SET display_name = ${name}, username = ${username}, password_hash = ${passwordHash}
					WHERE id = ${current.id} AND is_guest ${RETURNING(sql)}`;
				if (!row) throw new ApiError("conflict", 409, "You already have an account. Log out first.");
				return ok(c, { player: toPlayer(row as PlayerRow) });
			}
			const secret = newSecret();
			const row = await sql.begin(async (tx) => {
				const [p] = await tx`
					INSERT INTO players (display_name, username, password_hash) VALUES (${name}, ${username}, ${passwordHash}) ${RETURNING(tx)}`;
				await tx`INSERT INTO player_secrets (secret_hash, player_id) VALUES (${hashSecret(secret)}, ${p.id})`;
				return p as PlayerRow;
			});
			return ok(c, { player: toPlayer(row), playerSecret: secret }, 201);
		} catch (err) {
			if (isUniqueViolation(err)) throw new ApiError("conflict", 409, "Some fields are invalid.", { username: "That username is taken." });
			throw err;
		}
	});

	/** Signs in on this device: a new secret for this browser, the player's other devices stay signed in. */
	app.post("/players/login", rateLimit(LOGIN_LIMIT.perIp, LOGIN_LIMIT.windowMs), async (c) => {
		const { username, password } = parse(Login, await readJson(c));
		if (isLocked(username)) throw new ApiError("rate_limited", 429, "Too many wrong passwords. Try again in 15 minutes.");
		const [row] = (await sql`
			SELECT id, display_name, username, is_guest, created_at, disabled_at, password_hash FROM players WHERE username = ${username}`) as (PlayerRow & {
			password_hash: string | null;
		})[];
		dummyHash ??= Bun.password.hash("not-a-real-password");
		const valid = await Bun.password.verify(password, row?.password_hash ?? (await dummyHash));
		if (!row || !valid) {
			noteFailure(username);
			throw new ApiError("unauthenticated", 401, "Wrong username or password.");
		}
		failures.delete(username);
		if (row.disabled_at) throw new ApiError("forbidden", 403, "This player has been disabled.");
		const secret = newSecret();
		await sql`INSERT INTO player_secrets (secret_hash, player_id) VALUES (${hashSecret(secret)}, ${row.id})`;
		return ok(c, { player: toPlayer(row), playerSecret: secret });
	});

	/** Signs this device out: its secret stops working. */
	app.post("/players/logout", auth, async (c) => {
		await sql`UPDATE player_secrets SET revoked_at = now() WHERE secret_hash = ${hashSecret(bearer(c.req.header("authorization"))!)}`;
		return ok(c, { signedOut: true });
	});

	app.get("/players/me", auth, (c) => ok(c, { player: c.get("player") }));

	app.patch("/players/me", auth, async (c) => {
		const { name } = parse(NameBody, await readJson(c));
		const [row] = await sql`
			UPDATE players SET display_name = ${name} WHERE id = ${c.get("player").id} ${RETURNING(sql)}`;
		return ok(c, { player: toPlayer(row) });
	});

	/** Short-lived token for connecting to a room actor. Counts as the player being seen. */
	app.post("/play-tokens", auth, async (c) => {
		const player = c.get("player");
		await sql`UPDATE players SET last_seen_at = now() WHERE id = ${player.id}`;
		return ok(c, await signer.sign(player));
	});

	return app;
}
