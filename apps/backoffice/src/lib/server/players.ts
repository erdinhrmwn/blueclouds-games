import type { SQL } from 'bun';
import type { Admin } from './auth.ts';
import { audit } from './auth.ts';
import { REASON_MAX } from '../limits.ts';

export { REASON_MAX };

export const PAGE_SIZE = 50;
const PLAYER_MATCHES_LIMIT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

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

const PLAYER_COLUMNS = (sql: SQL) => sql`
	id,
	display_name AS name,
	created_at AS "createdAt",
	last_seen_at AS "lastSeenAt",
	disabled_at AS "disabledAt",
	disabled_reason AS "disabledReason",
	username,
	is_guest AS "isGuest",
	is_active AS "isActive",
	is_bot AS "isBot",
	is_vip AS "isVip"`;

export const PLAYER_TYPES = ['normal', 'vip', 'bot'] as const;
export const PLAYER_STATUSES = ['active', 'disabled'] as const;

export type PlayerFilter = {
	/** Part of a name or username, or an exact id. */
	q: string;
	/** Empty for every type. */
	type: (typeof PLAYER_TYPES)[number] | '';
	/** Empty for both. */
	status: (typeof PLAYER_STATUSES)[number] | '';
};

/**
 * Newest players first, narrowed by the filter. `before` is the last id of the previous page (ids are UUIDv7, so
 * they sort by creation time).
 */
export async function searchPlayers(
	sql: SQL,
	filter: PlayerFilter,
	before: string | null
): Promise<PlayerRow[]> {
	const page = before && isUuid(before) ? sql`AND id < ${before}` : sql``;

	const rows = await sql`
		SELECT ${PLAYER_COLUMNS(sql)}
		FROM players
		WHERE ${playerConditions(sql, filter)} ${page}
		ORDER BY id DESC
		LIMIT ${PAGE_SIZE}`;

	return rows as PlayerRow[];
}

/** The filter's conditions joined with AND; each empty field adds nothing. */
function playerConditions(sql: SQL, filter: PlayerFilter) {
	const conditions = [searchFilter(sql, filter.q.trim())];

	if (filter.type === 'bot') {
		conditions.push(sql`is_bot`);
	}
	if (filter.type === 'vip') {
		conditions.push(sql`is_vip AND NOT is_bot`);
	}
	if (filter.type === 'normal') {
		conditions.push(sql`NOT is_vip AND NOT is_bot`);
	}

	if (filter.status === 'active') {
		conditions.push(sql`is_active`);
	}
	if (filter.status === 'disabled') {
		conditions.push(sql`NOT is_active`);
	}

	return conditions.reduce((left, right) => sql`${left} AND ${right}`);
}

/** Nothing typed: everyone. An id: that player. Anything else: part of a name or username. */
function searchFilter(sql: SQL, term: string) {
	if (!term) return sql`TRUE`;
	if (isUuid(term)) return sql`id = ${term}`;

	return like(sql, term);
}

function like(sql: SQL, term: string) {
	// Escape LIKE's own wildcards so they match literally.
	const escaped = term.replace(/[\\%_]/g, '\\$&');
	const pattern = `%${escaped}%`;

	return sql`(display_name ILIKE ${pattern} OR username ILIKE ${pattern})`;
}

export type PlayerMatch = {
	id: string;
	game: string;
	gameName: string;
	roomCode: string;
	endedAt: Date;
	endReason: 'finished' | 'terminated';
	placement: number;
	players: number;
};

/** Matches a player sat in, and how many of them they won (placed first in a match played to the end). */
export type PlayerStats = {
	played: number;
	won: number;
};

export async function playerDetail(
	sql: SQL,
	id: string
): Promise<{ player: PlayerRow; matches: PlayerMatch[]; stats: PlayerStats } | null> {
	if (!isUuid(id)) return null;

	const [player] = (await sql`
		SELECT ${PLAYER_COLUMNS(sql)}
		FROM players
		WHERE id = ${id}`) as PlayerRow[];

	if (!player) return null;

	const matches = (await sql`
		SELECT
			m.id,
			m.game_slug AS game,
			g.name AS "gameName",
			r.code AS "roomCode",
			m.ended_at AS "endedAt",
			m.end_reason AS "endReason",
			mp.placement,
			(SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS players
		FROM match_players mp
		JOIN matches m ON m.id = mp.match_id
		JOIN games g ON g.slug = m.game_slug
		JOIN rooms r ON r.id = m.room_id
		WHERE mp.player_id = ${id}
		ORDER BY m.id DESC
		LIMIT ${PLAYER_MATCHES_LIMIT}`) as PlayerMatch[];

	const [stats] = (await sql`
		SELECT
			count(*)::int AS played,
			count(*) FILTER (WHERE mp.placement = 1 AND m.end_reason = 'finished')::int AS won
		FROM match_players mp
		JOIN matches m ON m.id = mp.match_id
		WHERE mp.player_id = ${id}`) as PlayerStats[];

	return { player, matches, stats: stats! };
}

/**
 * Disables a player and revokes every secret they hold, in one transaction with its audit row.
 * Returns false if the player doesn't exist or is already disabled.
 */
export async function disablePlayer(
	sql: SQL,
	admin: Admin,
	id: string,
	reason: string,
	ip: string | null
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE players
			SET disabled_at = now(), disabled_reason = ${reason}
			WHERE id = ${id} AND disabled_at IS NULL
			RETURNING id`;

		if (!row) return false;

		const revoked = await tx`
			UPDATE player_secrets
			SET revoked_at = now()
			WHERE player_id = ${id} AND revoked_at IS NULL
			RETURNING player_id`;

		await audit(tx, {
			adminId: admin.id,
			action: 'player.disable',
			playerId: id,
			detail: { reason, secretsRevoked: revoked.length },
			ip
		});

		return true;
	});
}

/** Lets the player back in. Their old secrets stay revoked, so they start a fresh guest. */
export async function enablePlayer(
	sql: SQL,
	admin: Admin,
	id: string,
	ip: string | null
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE players
			SET disabled_at = NULL, disabled_reason = NULL
			WHERE id = ${id} AND disabled_at IS NOT NULL
			RETURNING id`;

		if (!row) return false;

		await audit(tx, { adminId: admin.id, action: 'player.enable', playerId: id, ip });

		return true;
	});
}

/** Marks a player as VIP, with its audit row. Returns false if they already are one. */
export async function grantVip(
	sql: SQL,
	admin: Admin,
	id: string,
	ip: string | null
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE players
			SET is_vip = true
			WHERE id = ${id} AND NOT is_vip
			RETURNING id`;

		if (!row) return false;

		await audit(tx, { adminId: admin.id, action: 'player.vip_grant', playerId: id, ip });

		return true;
	});
}

/** Takes VIP away, with its audit row. Returns false if the player is not a VIP. */
export async function revokeVip(
	sql: SQL,
	admin: Admin,
	id: string,
	ip: string | null
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE players
			SET is_vip = false
			WHERE id = ${id} AND is_vip
			RETURNING id`;

		if (!row) return false;

		await audit(tx, { adminId: admin.id, action: 'player.vip_revoke', playerId: id, ip });

		return true;
	});
}
