import { sql } from '#lib/server/db.ts';
import { openTables } from '#lib/server/live.ts';
import { matchGames } from '#lib/server/matches.ts';
import { tournamentTables } from '#lib/server/tournaments.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const games = await matchGames(sql);
	const [open, tournament] = await Promise.all([openTables(games), tournamentTables(sql)]);

	return { open, tournament, checkedAt: new Date() };
};
