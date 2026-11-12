import { sql } from '#lib/server/db.ts';
import { listMatches, matchGames } from '#lib/server/matches.ts';
import { PAGE_SIZE } from '#lib/server/players.ts';
import type { PageServerLoad } from './$types';

const MAX_PARAM_LENGTH = 64;

export const load: PageServerLoad = async ({ url }) => {
	const get = (key: string) => (url.searchParams.get(key) ?? '').trim().slice(0, MAX_PARAM_LENGTH);

	const filter = {
		game: get('game'),
		player: get('player'),
		from: get('from'),
		to: get('to'),
		before: get('before')
	};
	const [matches, games] = await Promise.all([listMatches(sql, filter), matchGames(sql)]);
	const fullPage = matches.length === PAGE_SIZE;

	return {
		filter,
		games,
		matches,
		next: fullPage ? matches.at(-1)!.id : null
	};
};
