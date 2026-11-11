import type { SQL } from "bun";
import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

export type Player = { id: string; name: string; createdAt: string };
export type PlayerVariables = { player: Player };

/** 32 random bytes, base64url (43 chars). */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export const hashSecret = (secret: string) => new Bun.CryptoHasher("sha256").update(secret).digest();

type PlayerRow = { id: string; display_name: string; created_at: Date; disabled_at: Date | null };
export const toPlayer = (r: PlayerRow): Player => ({ id: r.id, name: r.display_name, createdAt: r.created_at.toISOString() });

function bearer(header: string | undefined): string | null {
	const match = header?.match(/^Bearer (\S+)$/);
	return match?.[1] ?? null;
}

/** Resolves `Authorization: Bearer <player secret>` to a player, or stops with 401/403. */
export const playerAuth = (sql: SQL) =>
	createMiddleware<{ Variables: PlayerVariables }>(async (c, next) => {
		const secret = bearer(c.req.header("authorization"));
		if (!secret || !SECRET_PATTERN.test(secret)) throw new ApiError("unauthenticated", 401, "Sign in as a player first.");
		const [row] = (await sql`
			SELECT p.id, p.display_name, p.created_at, p.disabled_at, s.revoked_at
			FROM player_secrets s JOIN players p ON p.id = s.player_id
			WHERE s.secret_hash = ${hashSecret(secret)}`) as (PlayerRow & { revoked_at: Date | null })[];
		// Disabled first: the backoffice revokes a disabled player's secrets too, and they should be told why.
		if (row?.disabled_at) throw new ApiError("forbidden", 403, "This player has been disabled.");
		if (!row || row.revoked_at) throw new ApiError("unauthenticated", 401, "Sign in as a player first.");
		c.set("player", toPlayer(row));
		await next();
	});

/** Checks `Authorization: Bearer <server key>` in constant time (both sides hashed to equal length). */
export const serverAuth = (serverKey: string) => {
	const expected = hashSecret(serverKey);
	return createMiddleware(async (c, next) => {
		const given = bearer(c.req.header("authorization"));
		if (!given || !timingSafeEqual(hashSecret(given), expected)) throw new ApiError("unauthenticated", 401, "Invalid server key.");
		await next();
	});
};
