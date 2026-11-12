import type { SQL } from "bun";
import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

/** A guest has a generated `guest_…` username and no password: it exists only in the browser that holds its secret. */
export type Player = { id: string; name: string; username: string | null; guest: boolean; createdAt: string };
export type PlayerVariables = { player: Player };

/** 32 random bytes, base64url (43 chars). */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export const hashSecret = (secret: string) => new Bun.CryptoHasher("sha256").update(secret).digest();

export type PlayerRow = { id: string; display_name: string; username: string | null; is_guest: boolean; created_at: Date; disabled_at: Date | null };
export const PLAYER_COLUMNS = (sql: SQL) => sql`p.id, p.display_name, p.username, p.is_guest, p.created_at, p.disabled_at`;
export const toPlayer = (r: PlayerRow): Player => ({
	id: r.id,
	name: r.display_name,
	username: r.username,
	guest: r.is_guest,
	createdAt: r.created_at.toISOString(),
});

export function bearer(header: string | undefined): string | null {
	const match = header?.match(/^Bearer (\S+)$/);
	return match?.[1] ?? null;
}

/**
 * The player behind `Authorization: Bearer <player secret>`: null when there is none or it was revoked.
 * Throws 403 for a disabled player: the backoffice revokes their secrets too, and they should be told why.
 */
export async function playerFromHeader(sql: SQL, header: string | undefined): Promise<PlayerRow | null> {
	const secret = bearer(header);
	if (!secret || !SECRET_PATTERN.test(secret)) return null;
	const [row] = (await sql`
		SELECT ${PLAYER_COLUMNS(sql)}, s.revoked_at
		FROM player_secrets s JOIN players p ON p.id = s.player_id
		WHERE s.secret_hash = ${hashSecret(secret)}`) as (PlayerRow & { revoked_at: Date | null })[];
	if (row?.disabled_at) throw new ApiError("forbidden", 403, "This player has been disabled.");
	return row && !row.revoked_at ? row : null;
}

/** Resolves `Authorization: Bearer <player secret>` to a player, or stops with 401/403. */
export const playerAuth = (sql: SQL) =>
	createMiddleware<{ Variables: PlayerVariables }>(async (c, next) => {
		const row = await playerFromHeader(sql, c.req.header("authorization"));
		if (!row) throw new ApiError("unauthenticated", 401, "Sign in as a player first.");
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
