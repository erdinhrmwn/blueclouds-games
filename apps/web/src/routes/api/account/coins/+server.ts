import { json } from '@sveltejs/kit';
import { coinsOf, failure } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** The player's coin balance and what changed it. */
export const GET: RequestHandler = async (event) => {
	try {
		const coins = await coinsOf(event);
		return json(coins, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		return failure(err);
	}
};
