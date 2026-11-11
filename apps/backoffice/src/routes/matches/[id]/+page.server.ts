import { error } from '@sveltejs/kit';
import { sql } from '#lib/server/db.ts';
import { matchDetail } from '#lib/server/matches.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const match = await matchDetail(sql, params.id);
	if (!match) error(404, 'Match not found');
	return { match };
};
