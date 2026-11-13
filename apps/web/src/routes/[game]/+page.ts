import { error } from '@sveltejs/kit';
import { gameBySlug } from '#lib/games/catalog.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, data }) => {
	const game = gameBySlug(params.game);
	if (!game) error(404, 'Game not found');
	return { game, maintenance: data.maintenance };
};
