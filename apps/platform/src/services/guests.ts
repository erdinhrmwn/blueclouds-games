import type { SQL } from "bun";

/** A guest that never played a match is deleted after this long unseen (Erdin, 2026-11-11). */
export const GUEST_UNUSED_DAYS = 30;
/** Rows per sweep, so one run never holds a long lock; a backlog clears over the next days. */
const SWEEP_BATCH = 5_000;

/**
 * A guest nobody else's history points at: no match, no tournament sign-up or seat, no admin audit entry.
 * The foreign keys refuse the delete anyway if one slips through; this keeps the sweep from tripping on them.
 */
const unused = (sql: SQL) => sql`
	p.is_guest
	AND NOT EXISTS (SELECT 1 FROM match_players mp WHERE mp.player_id = p.id)
	AND NOT EXISTS (SELECT 1 FROM tournament_players tp WHERE tp.player_id = p.id)
	AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.player_id = p.id)
	AND NOT EXISTS (SELECT 1 FROM admin_audit_events ae WHERE ae.player_id = p.id)`;

/** On logout: a guest can never come back once its secret is gone, so an unused one is deleted right away. */
export async function deleteGuestIfUnused(sql: SQL, playerId: string): Promise<boolean> {
	const rows =
		await sql`DELETE FROM players p WHERE p.id = ${playerId} AND ${unused(sql)} RETURNING p.id`;
	return rows.length > 0;
}

/** Deletes unused guests not seen for GUEST_UNUSED_DAYS. Returns how many went. */
export async function sweepGuests(sql: SQL, days = GUEST_UNUSED_DAYS): Promise<number> {
	const rows = await sql`
		DELETE FROM players WHERE id IN (
			SELECT p.id FROM players p
			WHERE p.last_seen_at < now() - make_interval(days => ${days}) AND ${unused(sql)}
			LIMIT ${SWEEP_BATCH})
		RETURNING id`;
	return rows.length;
}
