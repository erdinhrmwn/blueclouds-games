import type { SQL } from 'bun';
import { isUuid, PAGE_SIZE } from './players.ts';

export type AuditRow = {
	id: string;
	createdAt: Date;
	admin: string | null;
	action: string;
	playerId: string | null;
	playerName: string | null;
	tournamentId: string | null;
	tournamentName: string | null;
	roomCode: string | null;
	/** The admin an admin.* action was done to. */
	targetAdmin: string | null;
	detail: Record<string, unknown>;
	ip: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AuditFilter = {
	/** An admin's username; empty for everyone. */
	admin: string;
	/** One action, e.g. 'player.disable'; empty for all. */
	action: string;
	/** Only rows about this player. */
	player: string;
	/** UTC days, `to` inclusive. */
	from: string;
	to: string;
	/** The last id of the previous page (UUIDv7). */
	before: string;
};

export const NO_AUDIT_FILTER: AuditFilter = {
	admin: '',
	action: '',
	player: '',
	from: '',
	to: '',
	before: ''
};

/** Newest first. Empty or malformed filter fields are ignored. */
export async function listAudit(
	sql: SQL,
	filter: AuditFilter,
	limit = PAGE_SIZE
): Promise<AuditRow[]> {
	const rows = await sql`
		SELECT
			a.id,
			a.created_at AS "createdAt",
			ad.username AS admin,
			a.action,
			a.player_id AS "playerId",
			p.display_name AS "playerName",
			a.tournament_id AS "tournamentId",
			t.name AS "tournamentName",
			r.code AS "roomCode",
			ta.username AS "targetAdmin",
			a.detail,
			host(a.ip) AS ip
		FROM admin_audit_events a
		LEFT JOIN admins ad ON ad.id = a.admin_id
		LEFT JOIN players p ON p.id = a.player_id
		LEFT JOIN tournaments t ON t.id = a.tournament_id
		LEFT JOIN rooms r ON r.id = a.room_id
		LEFT JOIN admins ta ON ta.id = a.target_admin_id
		WHERE ${auditConditions(sql, filter)}
		ORDER BY a.id DESC
		LIMIT ${limit}`;

	return rows as AuditRow[];
}

/** The filter's conditions joined with AND; each empty or malformed field adds nothing. */
function auditConditions(sql: SQL, filter: AuditFilter) {
	const conditions = [sql`TRUE`];

	if (filter.admin) {
		conditions.push(sql`ad.username = ${filter.admin}`);
	}
	if (filter.action) {
		conditions.push(sql`a.action = ${filter.action}`);
	}
	if (isUuid(filter.player)) {
		conditions.push(sql`a.player_id = ${filter.player}`);
	}

	// AT TIME ZONE 'UTC': a bare ::date compares in the session's TimeZone, not UTC.
	if (DATE.test(filter.from)) {
		conditions.push(sql`a.created_at >= ${filter.from}::date::timestamp AT TIME ZONE 'UTC'`);
	}
	if (DATE.test(filter.to)) {
		conditions.push(sql`a.created_at < (${filter.to}::date + 1)::timestamp AT TIME ZONE 'UTC'`);
	}

	if (isUuid(filter.before)) {
		conditions.push(sql`a.id < ${filter.before}`);
	}

	return conditions.reduce((left, right) => sql`${left} AND ${right}`);
}

/** Every admin's username, for the filter. */
export async function auditAdmins(sql: SQL): Promise<string[]> {
	const rows = await sql`
		SELECT username
		FROM admins
		ORDER BY username`;

	return rows.map((row: { username: string }) => row.username);
}
