import { error } from '@sveltejs/kit';
import { gameBySlug } from '#lib/games/catalog.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const game = gameBySlug(params.game);
	if (!game) error(404, 'Game not found');
	return { game };
};
