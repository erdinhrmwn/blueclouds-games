import { listAudit, NO_AUDIT_FILTER } from '#lib/server/audit-log.ts';
import { sql } from '#lib/server/db.ts';
import { listMatches } from '#lib/server/matches.ts';
import { matchesPerDay, overviewStats } from '#lib/server/overview.ts';
import type { PageServerLoad } from './$types';

const RECENT_ROWS = 6;
const NO_FILTER = { game: '', player: '', from: '', to: '', before: '' };

export const load: PageServerLoad = async () => {
	const [stats, days, matches, audit] = await Promise.all([
		overviewStats(sql),
		matchesPerDay(sql),
		listMatches(sql, NO_FILTER, RECENT_ROWS),
		listAudit(sql, NO_AUDIT_FILTER, RECENT_ROWS)
	]);

	return { stats, days, matches, audit };
};
