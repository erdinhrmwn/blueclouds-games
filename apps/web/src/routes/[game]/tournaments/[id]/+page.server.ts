import { error } from '@sveltejs/kit';
import { gameBySlug } from '#lib/games/catalog.ts';
import { PlatformError, tournamentBoard } from '#lib/server/platform.ts';
import type { PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tournament's page: its rounds as a bracket, and its standings. */
export const load: PageServerLoad = async (event) => {
	const game = gameBySlug(event.params.game);
	if (!game || !UUID.test(event.params.id)) {
		error(404, 'Tournament not found');
	}

	try {
		const board = await tournamentBoard(event, event.params.id);
		if (board.tournament.game !== event.params.game) {
			error(404, 'Tournament not found');
		}

		return { board, game: { slug: game.slug, name: game.name } };
	} catch (err) {
		if (err instanceof PlatformError) {
			error(err.status, err.message);
		}

		throw err;
	}
};
