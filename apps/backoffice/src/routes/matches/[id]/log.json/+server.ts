import { error, json } from '@sveltejs/kit';
import { sql } from '#lib/server/db.ts';
import { matchLog } from '#lib/server/matches.ts';
import type { RequestHandler } from './$types';

/** The raw move log as a file, for a closer look or a bug report. Admins only (hooks.server.ts). */
export const GET: RequestHandler = async ({ params }) => {
	const log = await matchLog(sql, params.id);
	if (!log) {
		error(404, 'No move log for this match');
	}

	const headers = { 'Content-Disposition': `attachment; filename="match-${params.id}.json"` };
	return json({ matchId: params.id, ...log }, { headers });
};
