import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { hashSecret, newSecret, playerAuth, type PlayerVariables, toPlayer } from "./auth";
import { ok, parse, readJson } from "./http";
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

const GUEST_LIMIT = { perIp: 5, windowMs: 60_000 };

export function playerRoutes(sql: SQL, signer: Signer) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);

	/** New guest player. The secret is returned only here; the client keeps it. */
	app.post("/players/guest", rateLimit(GUEST_LIMIT.perIp, GUEST_LIMIT.windowMs), async (c) => {
		const { name } = parse(NameBody, await readJson(c));
		const secret = newSecret();
		const row = await sql.begin(async (tx) => {
			const [p] = await tx`INSERT INTO players (display_name) VALUES (${name}) RETURNING id, display_name, created_at, disabled_at`;
			await tx`INSERT INTO player_secrets (secret_hash, player_id) VALUES (${hashSecret(secret)}, ${p.id})`;
			return p;
		});
		return ok(c, { player: toPlayer(row), playerSecret: secret }, 201);
	});

	app.get("/players/me", auth, (c) => ok(c, { player: c.get("player") }));

	app.patch("/players/me", auth, async (c) => {
		const { name } = parse(NameBody, await readJson(c));
		const [row] = await sql`
			UPDATE players SET display_name = ${name} WHERE id = ${c.get("player").id}
			RETURNING id, display_name, created_at, disabled_at`;
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
