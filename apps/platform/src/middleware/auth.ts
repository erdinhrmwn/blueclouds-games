import type { SQL } from "bun";
import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "../lib/http";
import { hashSecret } from "../lib/secrets";
import { findBySecret, type Player, toPlayer } from "../services/players";

export type PlayerVariables = { player: Player };

export function bearer(header: string | undefined): string | null {
	const match = header?.match(/^Bearer (\S+)$/);
	return match?.[1] ?? null;
}

/** Resolves `Authorization: Bearer <player secret>` to a player, or stops with 401/403. */
export const playerAuth = (sql: SQL) =>
	createMiddleware<{ Variables: PlayerVariables }>(async (c, next) => {
		const secret = bearer(c.req.header("authorization"));
		const row = await findBySecret(sql, secret);
		if (!row) {
			throw new ApiError("unauthenticated", 401, "Sign in as a player first.");
		}

		c.set("player", toPlayer(row));
		await next();
	});

/** Checks `Authorization: Bearer <server key>` in constant time (both sides hashed to equal length). */
export const serverAuth = (serverKey: string) => {
	const expected = hashSecret(serverKey);

	return createMiddleware(async (c, next) => {
		const given = bearer(c.req.header("authorization"));
		if (!given || !timingSafeEqual(hashSecret(given), expected)) {
			throw new ApiError("unauthenticated", 401, "Invalid server key.");
		}

		await next();
	});
};
