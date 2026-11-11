import type { SQL } from 'bun';
import type { Admin } from './auth.ts';
import { audit } from './auth.ts';
import { REASON_MAX } from '../limits.ts';

export { REASON_MAX };

export const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export type PlayerRow = {
	id: string;
	name: string;
	createdAt: Date;
	lastSeenAt: Date;
	disabledAt: Date | null;
	disabledReason: string | null;
	/** A guest's is generated (guest_123456); null only for players from before guest usernames. */
	username: string | null;
	/** No password: lives in one browser until it links an account. */
	isGuest: boolean;
	isActive: boolean;
	isBot: boolean;
	isVip: boolean;
};

const PLAYER_COLUMNS = (sql: SQL) =>
	sql`id, display_name AS name, created_at AS "createdAt", last_seen_at AS "lastSeenAt", disabled_at AS "disabledAt", disabled_reason AS "disabledReason",
	    username, is_guest AS "isGuest", is_active AS "isActive", is_bot AS "isBot", is_vip AS "isVip"`;

/**
 * Newest players first. `q` matches an exact id, or part of a name or username. `before` is the last id of the
 * previous page (ids are UUIDv7, so they sort by creation time).
 */
export async function searchPlayers(sql: SQL, q: string, before: string | null): Promise<PlayerRow[]> {
	const term = q.trim();
	const filter = !term
		? sql`TRUE`
		: isUuid(term)
			? sql`id = ${term}`
			: like(sql, term);
	const page = before && isUuid(before) ? sql`AND id < ${before}` : sql``;
	return (await sql`SELECT ${PLAYER_COLUMNS(sql)} FROM players WHERE ${filter} ${page} ORDER BY id DESC LIMIT ${PAGE_SIZE}`) as PlayerRow[];
}

function like(sql: SQL, term: string) {
	const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
	return sql`(display_name ILIKE ${pattern} OR username ILIKE ${pattern})`;
}

export type PlayerMatch = { id: string; game: string; gameName: string; roomCode: string; endedAt: Date; placement: number; players: number };

export async function playerDetail(sql: SQL, id: string): Promise<{ player: PlayerRow; matches: PlayerMatch[] } | null> {
	if (!isUuid(id)) return null;
	const [player] = (await sql`SELECT ${PLAYER_COLUMNS(sql)} FROM players WHERE id = ${id}`) as PlayerRow[];
	if (!player) return null;
	const matches = (await sql`
		SELECT m.id, m.game_slug AS game, g.name AS "gameName", r.code AS "roomCode", m.ended_at AS "endedAt", mp.placement,
		       (SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS players
		FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN games g ON g.slug = m.game_slug JOIN rooms r ON r.id = m.room_id
		WHERE mp.player_id = ${id}
		ORDER BY m.id DESC LIMIT 20`) as PlayerMatch[];
	return { player, matches };
}

/**
 * Disables a player and revokes every secret they hold, in one transaction with its audit row.
 * Returns false if the player doesn't exist or is already disabled.
 */
export async function disablePlayer(sql: SQL, admin: Admin, id: string, reason: string, ip: string | null): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE players SET disabled_at = now(), disabled_reason = ${reason}
			WHERE id = ${id} AND disabled_at IS NULL RETURNING id`;
		if (!row) return false;
		const revoked = await tx`UPDATE player_secrets SET revoked_at = now() WHERE player_id = ${id} AND revoked_at IS NULL RETURNING player_id`;
		await audit(tx, { adminId: admin.id, action: 'player.disable', playerId: id, detail: { reason, secretsRevoked: revoked.length }, ip });
		return true;
	});
}

/** Lets the player back in. Their old secrets stay revoked, so they start a fresh guest. */
export async function enablePlayer(sql: SQL, admin: Admin, id: string, ip: string | null): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE players SET disabled_at = NULL, disabled_reason = NULL
			WHERE id = ${id} AND disabled_at IS NOT NULL RETURNING id`;
		if (!row) return false;
		await audit(tx, { adminId: admin.id, action: 'player.enable', playerId: id, ip });
		return true;
	});
}

/** Marks a player as VIP or takes it back, with its audit row. Returns false if nothing changed. */
export async function setVip(sql: SQL, admin: Admin, id: string, vip: boolean, ip: string | null): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`UPDATE players SET is_vip = ${vip} WHERE id = ${id} AND is_vip <> ${vip} RETURNING id`;
		if (!row) return false;
		await audit(tx, { adminId: admin.id, action: vip ? 'player.vip_grant' : 'player.vip_revoke', playerId: id, ip });
		return true;
	});
}
