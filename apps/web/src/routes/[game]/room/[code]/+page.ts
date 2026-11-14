import { error } from '@sveltejs/kit';
import { gameBySlug } from '#lib/games/catalog.ts';
import { isRoomCode } from '#lib/guest.ts';
import type { PageLoad } from './$types';

// Needs localStorage and a live WebSocket, so it only runs in the browser.
export const ssr = false;

export const load: PageLoad = ({ params }) => {
	const game = gameBySlug(params.game);
	if (!game) {
		error(404, 'Game not found');
	}

	const code = params.code.toUpperCase();
	if (!isRoomCode(code)) {
		error(404, 'Invalid table code');
	}

	return { game, code };
};
