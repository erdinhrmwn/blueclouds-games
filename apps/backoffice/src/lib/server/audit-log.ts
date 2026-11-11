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
	detail: Record<string, unknown>;
	ip: string | null;
};

/** Newest first. `before` is the last id of the previous page (UUIDv7). */
export async function listAudit(sql: SQL, before: string | null): Promise<AuditRow[]> {
	const page = before && isUuid(before) ? sql`WHERE a.id < ${before}` : sql``;
	return (await sql`
		SELECT a.id, a.created_at AS "createdAt", ad.username AS admin, a.action, a.player_id AS "playerId",
		       p.display_name AS "playerName", a.tournament_id AS "tournamentId", t.name AS "tournamentName", r.code AS "roomCode",
		       a.detail, host(a.ip) AS ip
		FROM admin_audit_events a
		LEFT JOIN admins ad ON ad.id = a.admin_id
		LEFT JOIN players p ON p.id = a.player_id
		LEFT JOIN tournaments t ON t.id = a.tournament_id
		LEFT JOIN rooms r ON r.id = a.room_id
		${page}
		ORDER BY a.id DESC LIMIT ${PAGE_SIZE}`) as AuditRow[];
}
