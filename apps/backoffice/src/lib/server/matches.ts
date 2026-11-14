import type { SQL } from 'bun';
import { checkMatch, proofsFromLog } from 'server/games/shared/fairness';
import type { MatchLog } from '../replay.ts';
import { isUuid, PAGE_SIZE } from './players.ts';

export type MatchFilter = {
	game: string;
	player: string;
	from: string;
	to: string;
	before: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type MatchRow = {
	id: string;
	game: string;
	gameName: string;
	roomCode: string;
	endedAt: Date;
	/** terminated: an admin stopped it; it has no winner. */
	endReason: 'finished' | 'terminated';
	players: number;
	winner: string | null;
};

/** Newest matches first. Empty or malformed filters are ignored; dates are UTC days, `to` inclusive. */
export async function listMatches(
	sql: SQL,
	filter: MatchFilter,
	limit = PAGE_SIZE
): Promise<MatchRow[]> {
	const rows = await sql`
		SELECT
			m.id,
			m.game_slug AS game,
			g.name AS "gameName",
			r.code AS "roomCode",
			m.ended_at AS "endedAt",
			m.end_reason AS "endReason",
			(
				SELECT count(*)::int
				FROM match_players x
				WHERE x.match_id = m.id
			) AS players,
			(
				SELECT coalesce(p.display_name, w.bot_name)
				FROM match_players w
				LEFT JOIN players p ON p.id = w.player_id
				WHERE w.match_id = m.id
					AND w.placement = 1
					AND m.end_reason = 'finished'
				LIMIT 1
			) AS winner
		FROM matches m
		JOIN games g ON g.slug = m.game_slug
		JOIN rooms r ON r.id = m.room_id
		WHERE ${matchConditions(sql, filter)}
		ORDER BY m.id DESC
		LIMIT ${limit}`;

	return rows as MatchRow[];
}

/** The filter's conditions joined with AND; each empty or malformed field adds nothing. */
function matchConditions(sql: SQL, filter: MatchFilter) {
	const conditions = [sql`TRUE`];

	if (filter.game) {
		conditions.push(sql`m.game_slug = ${filter.game}`);
	}

	if (isUuid(filter.player)) {
		conditions.push(sql`
			EXISTS (
				SELECT 1 FROM match_players x
				WHERE x.match_id = m.id AND x.player_id = ${filter.player}
			)`);
	}

	// AT TIME ZONE 'UTC': a bare ::date compares in the session's TimeZone, not UTC.
	if (DATE.test(filter.from)) {
		conditions.push(sql`m.ended_at >= ${filter.from}::date::timestamp AT TIME ZONE 'UTC'`);
	}

	if (DATE.test(filter.to)) {
		conditions.push(sql`m.ended_at < (${filter.to}::date + 1)::timestamp AT TIME ZONE 'UTC'`);
	}

	if (isUuid(filter.before)) {
		conditions.push(sql`m.id < ${filter.before}`);
	}

	return conditions.reduce((left, right) => sql`${left} AND ${right}`);
}

/** Every game in the catalog, for the filter. */
export async function matchGames(sql: SQL): Promise<{ slug: string; name: string }[]> {
	const rows = await sql`
		SELECT slug, name
		FROM games
		ORDER BY name`;

	return rows as { slug: string; name: string }[];
}

export type Seat = {
	seat: number;
	playerId: string | null;
	name: string | null;
	bot: boolean;
	placement: number;
	score: number;
};

/** Where the match was played: a tournament table, or an open table and who opened it (both null when the platform made it). */
export type MatchTable = {
	tournamentId: string | null;
	tournamentName: string | null;
	openedByPlayerId: string | null;
	openedByPlayer: string | null;
	openedByAdmin: string | null;
};

export type MatchDetail = Omit<MatchRow, 'players' | 'winner'> &
	MatchTable & { rulesVersion: number; startedAt: Date; scoreLabel: string; seats: Seat[] };

export async function matchDetail(sql: SQL, id: string): Promise<MatchDetail | null> {
	if (!isUuid(id)) {
		return null;
	}

	const [match] = await sql`
		SELECT
			m.id,
			m.game_slug AS game,
			g.name AS "gameName",
			g.score_label AS "scoreLabel",
			r.code AS "roomCode",
			m.rules_version AS "rulesVersion",
			m.started_at AS "startedAt",
			m.ended_at AS "endedAt",
			m.end_reason AS "endReason",
			r.tournament_id AS "tournamentId",
			t.name AS "tournamentName",
			r.created_by_player_id AS "openedByPlayerId",
			op.display_name AS "openedByPlayer",
			oa.username AS "openedByAdmin"
		FROM matches m
		JOIN games g ON g.slug = m.game_slug
		JOIN rooms r ON r.id = m.room_id
		LEFT JOIN tournaments t ON t.id = r.tournament_id
		LEFT JOIN players op ON op.id = r.created_by_player_id
		LEFT JOIN admins oa ON oa.id = r.created_by_admin_id
		WHERE m.id = ${id}`;

	if (!match) {
		return null;
	}

	const seats = (await sql`
		SELECT
			mp.seat,
			mp.player_id AS "playerId",
			coalesce(p.display_name, mp.bot_name) AS name,
			mp.player_id IS NULL AS bot,
			mp.placement,
			mp.score
		FROM match_players mp
		LEFT JOIN players p ON p.id = mp.player_id
		WHERE mp.match_id = ${id}
		ORDER BY mp.placement, mp.seat`) as Seat[];

	return { ...match, seats };
}

/** The match's move log, or null for a match stored before logs existed. Holds every hand: backoffice only. */
export async function matchLog(sql: SQL, id: string): Promise<MatchLog | null> {
	if (!isUuid(id)) {
		return null;
	}

	const [row] = await sql`
		SELECT log_version AS "logVersion", events
		FROM match_logs
		WHERE match_id = ${id}`;

	return (row as MatchLog | undefined) ?? null;
}

/**
 * How a match's rounds check against their seeds: null when it has none, else how many rounds and shuffles were
 * checked and which failed, each as "round 2" (its seed) or "round 2 #1" (a shuffle).
 */
export type FairnessResult = {
	ok: boolean;
	rounds: number;
	shuffles: number;
	failed: string[];
} | null;

/**
 * Checks every closed round in the log against the seed it revealed, the way a player can (fairness.ts): the
 * seed against the hash shown before the round, the rounds in order, and every shuffle.
 */
export async function checkMatchFairness(
	matchId: string,
	log: MatchLog | null
): Promise<FairnessResult> {
	const proofs = log ? proofsFromLog(matchId, log.events) : [];
	if (proofs.length === 0) {
		return null;
	}

	const check = await checkMatch(proofs);
	const failed = check.rounds.flatMap((round) => {
		const badShuffles = round.shuffles
			.filter((shuffle) => !shuffle.ok)
			.map((shuffle) => `round ${round.round} #${shuffle.nonce}`);

		if (round.ok || badShuffles.length > 0) {
			return badShuffles;
		}

		return [`round ${round.round}`];
	});
	const shuffles = check.rounds.reduce((count, round) => count + round.shuffles.length, 0);

	return { ok: check.ok, rounds: check.rounds.length, shuffles, failed };
}
