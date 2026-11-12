import { PAGE_SIZE, searchPlayers } from '#lib/server/players.ts';
import { sql } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

const MAX_QUERY_LENGTH = 64;

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH);
	const before = url.searchParams.get('before');

	const players = await searchPlayers(sql, q, before);
	const fullPage = players.length === PAGE_SIZE;

	return {
		q,
		players,
		next: fullPage ? players.at(-1)!.id : null,
		paged: !!before
	};
};
