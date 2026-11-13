import type { TournamentFormat } from '#lib/platform.ts';

type Format = {
	label: string;
	note: string;
	/** "How it plays" in the Detail dialog, given the players per table and (Arena, Swiss) the rounds. */
	steps: (perTable: number, rounds: number) => string[];
};

/** How each tournament format reads on a card and in its Detail dialog. Keep in step with the backoffice's list. */
export const FORMATS: Record<TournamentFormat, Format> = {
	arena: {
		label: 'Arena',
		note: 'Most points wins',
		steps: (perTable, rounds) => [
			`Everyone plays ${rounds} rounds at tables of up to ${perTable}, reshuffled each round.`,
			'Each match gives points by finishing place: 1st at a table of 6 scores 6, last scores 1.',
			'The most points after the last round wins.'
		]
	},
	knockout: {
		label: 'Knockout',
		note: 'Lose and you’re out',
		steps: (perTable) => [
			`Everyone is seated at tables of up to ${perTable} when sign-up closes.`,
			'Each table plays one match; only its winner goes on.',
			'Winners meet at new tables until one player is left.'
		]
	},
	swiss: {
		label: 'Swiss',
		note: 'Paired by score',
		steps: (perTable, rounds) => [
			`Everyone plays ${rounds} rounds at tables of up to ${perTable}, scoring points by finishing place.`,
			'From round 2 you sit with players on a similar score.',
			'Nobody is knocked out; the most points after the last round wins.'
		]
	}
};

/** "3,500 coins", in the viewer's own number format. */
export const coins = (amount: number) => `${amount.toLocaleString()} coins`;

const MINUTE_MS = 60_000;
const HOUR_MIN = 60;
const DAY_MIN = 24 * HOUR_MIN;

/** "Starts in 6h 32m", "Starts in 1d 4h", "Starts in 3 days", or "Starting now" once it is time. */
export function startsIn(startsAt: string, now: number): string {
	const minutes = Math.ceil((Date.parse(startsAt) - now) / MINUTE_MS);
	if (minutes <= 0) {
		return 'Starting now';
	}

	const days = Math.floor(minutes / DAY_MIN);
	const hours = Math.floor((minutes % DAY_MIN) / HOUR_MIN);
	const rest = minutes % HOUR_MIN;

	if (days >= 2) {
		return `Starts in ${days} days`;
	}

	if (days === 1) {
		return `Starts in 1d ${hours}h`;
	}

	if (hours > 0) {
		return `Starts in ${hours}h ${rest}m`;
	}

	return `Starts in ${rest}m`;
}
