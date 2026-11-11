import type { SQL } from 'bun';
import { isUuid, PAGE_SIZE } from './players.ts';

export type MatchFilter = { game: string; player: string; from: string; to: string; before: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type MatchRow = { id: string; game: string; roomCode: string; endedAt: Date; players: number; winner: string | null };

/** Newest matches first. Empty or malformed filters are ignored; dates are UTC days, `to` inclusive. */
export async function listMatches(sql: SQL, f: MatchFilter): Promise<MatchRow[]> {
	const where = [sql`TRUE`];
	if (f.game) where.push(sql`m.game_slug = ${f.game}`);
	if (isUuid(f.player)) where.push(sql`EXISTS (SELECT 1 FROM match_players x WHERE x.match_id = m.id AND x.player_id = ${f.player})`);
	if (DATE.test(f.from)) where.push(sql`m.ended_at >= ${f.from}::date`);
	if (DATE.test(f.to)) where.push(sql`m.ended_at < ${f.to}::date + 1`);
	if (isUuid(f.before)) where.push(sql`m.id < ${f.before}`);
	const filter = where.reduce((a, b) => sql`${a} AND ${b}`);
	return (await sql`
		SELECT m.id, m.game_slug AS game, m.room_code AS "roomCode", m.ended_at AS "endedAt",
		       (SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS players,
		       (SELECT coalesce(p.display_name, w.bot_name) FROM match_players w LEFT JOIN players p ON p.id = w.player_id
		        WHERE w.match_id = m.id AND w.placement = 1 LIMIT 1) AS winner
		FROM matches m WHERE ${filter}
		ORDER BY m.id DESC LIMIT ${PAGE_SIZE}`) as MatchRow[];
}

/** Games that have at least one match, for the filter. */
export async function matchGames(sql: SQL): Promise<string[]> {
	return (await sql`SELECT DISTINCT game_slug FROM matches ORDER BY 1`).map((r: { game_slug: string }) => r.game_slug);
}

export type Seat = { seat: number; playerId: string | null; name: string | null; bot: boolean; placement: number; livesLeft: number };
export type MatchDetail = Omit<MatchRow, 'players' | 'winner'> & { rulesVersion: number; startedAt: Date; seats: Seat[] };

export async function matchDetail(sql: SQL, id: string): Promise<MatchDetail | null> {
	if (!isUuid(id)) return null;
	const [m] = await sql`
		SELECT id, game_slug AS game, room_code AS "roomCode", rules_version AS "rulesVersion", started_at AS "startedAt", ended_at AS "endedAt"
		FROM matches WHERE id = ${id}`;
	if (!m) return null;
	const seats = (await sql`
		SELECT mp.seat, mp.player_id AS "playerId", coalesce(p.display_name, mp.bot_name) AS name, mp.player_id IS NULL AS bot,
		       mp.placement, mp.lives_left AS "livesLeft"
		FROM match_players mp LEFT JOIN players p ON p.id = mp.player_id
		WHERE mp.match_id = ${id} ORDER BY mp.placement, mp.seat`) as Seat[];
	return { ...m, seats };
}
