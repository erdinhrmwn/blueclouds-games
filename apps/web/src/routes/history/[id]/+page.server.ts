import { error } from '@sveltejs/kit';
import { matchRounds, PlatformError } from '#lib/server/platform.ts';
import type { PageServerLoad } from './$types';

/** One match's rounds, running or finished. Matches are public: any player may open one. */
export const load: PageServerLoad = async (event) => {
	try {
		return await matchRounds(event, event.params.id);
	} catch (err) {
		if (err instanceof PlatformError) {
			error(err.status, err.message);
		}

		throw err;
	}
};
