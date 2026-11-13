import { json } from '@sveltejs/kit';
import { failure, matchRounds } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** A match's rounds for the Fair play dialog, read while the match is played. */
export const GET: RequestHandler = async (event) => {
	try {
		const rounds = await matchRounds(event, event.params.id);
		return json(rounds);
	} catch (err) {
		return failure(err);
	}
};
