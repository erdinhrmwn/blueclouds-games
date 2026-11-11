import { error } from '@sveltejs/kit';
import { sql } from '#lib/server/db.ts';
import { matchDetail, matchLog } from '#lib/server/matches.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [match, log] = await Promise.all([matchDetail(sql, params.id), matchLog(sql, params.id)]);
	if (!match) error(404, 'Match not found');
	return { match, log };
};
