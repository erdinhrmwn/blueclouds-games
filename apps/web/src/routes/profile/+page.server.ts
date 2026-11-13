import { myMatches, myStats, PlatformError } from '#lib/server/platform.ts';
import type { PageServerLoad } from './$types';

/** How many finished matches the profile shows; the rest are on the history page. */
const RECENT_COUNT = 4;

/**
 * The player's record per game and their latest matches. Both are extras on the profile: when the platform
 * can't answer (or there is no player yet), the page still shows the name and account.
 */
export const load: PageServerLoad = async (event) => {
	try {
		const [record, history] = await Promise.all([myStats(event), myMatches(event, null)]);

		return { stats: record.games, recent: history.matches.slice(0, RECENT_COUNT) };
	} catch (err) {
		if (!(err instanceof PlatformError)) {
			throw err;
		}

		return { stats: [], recent: [] };
	}
};
