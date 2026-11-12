import type { SQL } from 'bun';

/** Days of matches the overview chart shows, ending today (UTC). */
export const CHART_DAYS = 14;

export type OverviewStats = {
	players: {
		/** People, not bots. */
		total: number;
		joinedLastDay: number;
		seenLastDay: number;
		vip: number;
		bots: number;
		disabled: number;
	};
	matches: {
		total: number;
		lastDay: number;
	};
	tournaments: {
		/** Not cancelled and not ended yet. */
		open: number;
		needAttention: number;
	};
};

/** The overview's counts. "Last day" is the last 24 hours, not the calendar day. */
export async function overviewStats(sql: SQL): Promise<OverviewStats> {
	const [[players], [matches], [tournaments]] = await Promise.all([
		sql`
			SELECT
				count(*) FILTER (WHERE NOT is_bot)::int AS total,
				count(*) FILTER (WHERE NOT is_bot AND created_at > now() - interval '24 hours')::int
					AS "joinedLastDay",
				count(*) FILTER (WHERE NOT is_bot AND last_seen_at > now() - interval '24 hours')::int
					AS "seenLastDay",
				count(*) FILTER (WHERE is_vip AND NOT is_bot)::int AS vip,
				count(*) FILTER (WHERE is_bot)::int AS bots,
				count(*) FILTER (WHERE NOT is_active)::int AS disabled
			FROM players`,
		sql`
			SELECT
				count(*)::int AS total,
				count(*) FILTER (WHERE ended_at > now() - interval '24 hours')::int AS "lastDay"
			FROM matches`,
		sql`
			SELECT
				count(*)::int AS open,
				count(*) FILTER (WHERE distributed_at IS NULL AND distribute_error IS NOT NULL)::int
					AS "needAttention"
			FROM tournaments
			WHERE cancelled_at IS NULL
				AND ended_at IS NULL`
	]);

	return { players, matches, tournaments } as OverviewStats;
}

export type MatchDay = {
	/** "2026-11-12", a UTC day. */
	day: string;
	matches: number;
};

/** Finished matches per UTC day for the last CHART_DAYS days, oldest first; days without a match count 0. */
export async function matchesPerDay(sql: SQL): Promise<MatchDay[]> {
	// Plain timestamps for UTC days, then AT TIME ZONE 'UTC': the session's TimeZone may not be UTC (on the Mac).
	const rows = await sql`
		SELECT
			to_char(day, 'YYYY-MM-DD') AS day,
			count(m.id)::int AS matches
		FROM generate_series(
			((now() AT TIME ZONE 'UTC')::date - ${CHART_DAYS - 1}::int)::timestamp,
			(now() AT TIME ZONE 'UTC')::date::timestamp,
			interval '1 day'
		) AS day
		LEFT JOIN matches m
			ON m.ended_at >= day AT TIME ZONE 'UTC'
			AND m.ended_at < (day + interval '1 day') AT TIME ZONE 'UTC'
		GROUP BY day
		ORDER BY day`;

	return rows as MatchDay[];
}
