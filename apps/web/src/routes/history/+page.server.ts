import { error } from '@sveltejs/kit';
import { myMatches, PlatformError } from '#lib/server/platform.ts';
import type { PageServerLoad } from './$types';

/** The player's finished matches, newest first; `?cursor=` pages back. */
export const load: PageServerLoad = async (event) => {
	const cursor = event.url.searchParams.get('cursor');

	try {
		return await myMatches(event, cursor);
	} catch (err) {
		if (err instanceof PlatformError) {
			error(err.status, err.message);
		}

		throw err;
	}
};
