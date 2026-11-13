import { error } from '@sveltejs/kit';
import { sql } from '#lib/server/db.ts';
import { checkMatchFairness, matchDetail, matchLog } from '#lib/server/matches.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [match, log] = await Promise.all([matchDetail(sql, params.id), matchLog(sql, params.id)]);
	if (!match) error(404, 'Match not found');

	const fairness = await checkMatchFairness(match, log);

	return { match, log, fairness };
};
