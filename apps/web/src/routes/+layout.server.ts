import { redirect } from '@sveltejs/kit';
import { nextPath, WELCOME } from '#lib/guest.ts';
import { whoAmI } from '#lib/server/platform.ts';
import type { LayoutServerLoad } from './$types';

/** Every page needs a player: without one you land on the welcome page, then come back to where you were going. */
export const load: LayoutServerLoad = async (event) => {
	const me = await whoAmI(event);
	const { pathname, search } = event.url;
	if (!me && pathname !== WELCOME)
		redirect(
			303,
			pathname === '/' && !search
				? WELCOME
				: `${WELCOME}?next=${encodeURIComponent(pathname + search)}`
		);
	if (me && pathname === WELCOME) redirect(303, nextPath(event.url));
	return { me };
};
