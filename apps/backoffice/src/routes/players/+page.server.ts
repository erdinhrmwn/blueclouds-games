import {
	PAGE_SIZE,
	PLAYER_STATUSES,
	PLAYER_TYPES,
	type PlayerFilter,
	searchPlayers
} from '#lib/server/players.ts';
import { sql } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

const MAX_QUERY_LENGTH = 64;

/** A query value if it is one of `allowed`, else '' (no filter). */
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
	const known = allowed.find((option) => option === value);

	return known ?? '';
}

export const load: PageServerLoad = async ({ url }) => {
	const params = url.searchParams;
	const filter: PlayerFilter = {
		q: (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
		type: oneOf(params.get('type'), PLAYER_TYPES),
		status: oneOf(params.get('status'), PLAYER_STATUSES)
	};
	const before = params.get('before');

	const players = await searchPlayers(sql, filter, before);
	const fullPage = players.length === PAGE_SIZE;

	return {
		filter,
		players,
		next: fullPage ? players.at(-1)!.id : null,
		paged: !!before
	};
};
