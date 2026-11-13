import type { TournamentFormat } from '#lib/platform.ts';

/** How each tournament format reads on a card and in its Detail dialog. Keep in step with the backoffice's list. */
export const FORMATS: Record<TournamentFormat, { label: string; note: string }> = {
	arena: { label: 'Arena', note: 'Most points wins' },
	knockout: { label: 'Knockout', note: 'Lose and you’re out' },
	swiss: { label: 'Swiss', note: 'Paired by score' }
};
