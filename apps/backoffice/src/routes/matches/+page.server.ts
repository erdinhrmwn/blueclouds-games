import { sql } from '#lib/server/db.ts';
import { listMatches, matchGames } from '#lib/server/matches.ts';
import { PAGE_SIZE } from '#lib/server/players.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const get = (k: string) => (url.searchParams.get(k) ?? '').trim().slice(0, 64);
	const filter = { game: get('game'), player: get('player'), from: get('from'), to: get('to'), before: get('before') };
	const [matches, games] = await Promise.all([listMatches(sql, filter), matchGames(sql)]);
	return { filter, games, matches, next: matches.length === PAGE_SIZE ? matches.at(-1)!.id : null };
};
