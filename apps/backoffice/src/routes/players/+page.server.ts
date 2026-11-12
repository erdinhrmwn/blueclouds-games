import { PAGE_SIZE, searchPlayers } from '#lib/server/players.ts';
import { sql } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').slice(0, 64);
	const before = url.searchParams.get('before');
	const players = await searchPlayers(sql, q, before);
	return {
		q,
		players,
		next: players.length === PAGE_SIZE ? players.at(-1)!.id : null,
		paged: !!before
	};
};
