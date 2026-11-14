import dayjs from 'dayjs';
import durationPlugin from 'dayjs/plugin/duration';
import type { TournamentFormat } from '#lib/platform.ts';

dayjs.extend(durationPlugin);

/** "1 point", "3 points". */
export function pointsText(points: number): string {
	return points === 1 ? '1 point' : `${points} points`;
}

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

/** "Starts in 6h 32m", "Starts in 1d 4h", "Starts in 3 days", or "Starting now" once it is time. */
export function startsIn(startsAt: string, now: number): string {
	// Rounded up, so "Starts in 1m" shows until the very start.
	const minutesLeft = Math.ceil(dayjs(startsAt).diff(now, 'minute', true));
	if (minutesLeft <= 0) {
		return 'Starting now';
	}

	const left = dayjs.duration(minutesLeft, 'minutes');
	const days = Math.floor(left.asDays());

	if (days >= 2) {
		return `Starts in ${days} days`;
	}

	if (days === 1) {
		return `Starts in 1d ${left.hours()}h`;
	}

	if (left.hours() > 0) {
		return `Starts in ${left.hours()}h ${left.minutes()}m`;
	}

	return `Starts in ${left.minutes()}m`;
}

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'];

/** "1st", "2nd", "3rd", "4th", "11th", "21st"… */
export function ordinal(place: number): string {
	const lastTwo = place % 100;
	const last = place % 10;
	const teen = lastTwo >= 11 && lastTwo <= 13;
	const suffix = teen ? 'th' : (ORDINAL_SUFFIX[last] ?? 'th');

	return `${place}${suffix}`;
}

/** "42 sec", "3 min 5 sec" or "1 h 12 min": how long a tournament ran. */
export function ranFor(from: string, to: string): string {
	const elapsedMs = Math.max(0, dayjs(to).diff(from));
	const elapsed = dayjs.duration(Math.round(elapsedMs / 1000), 'seconds');

	if (elapsed.asMinutes() < 1) {
		return elapsed.format('s [sec]');
	}

	if (elapsed.asHours() < 1) {
		return elapsed.format('m [min] s [sec]');
	}

	// Past an hour the seconds are noise. Whole hours, so a long tournament doesn't wrap at a day.
	const hours = Math.floor(elapsed.asHours());
	return `${hours} h ${elapsed.minutes()} min`;
}

/** Arena and Swiss rank by points; a knockout by how far you got. */
export const ranksByPoints = (format: TournamentFormat | null) =>
	format === 'arena' || format === 'swiss';

/** Avatar colours from the games' palette, picked by name so a player keeps theirs everywhere. */
const AVATAR_TONES = ['bg-ember', 'bg-rain', 'bg-wind', 'bg-storm', 'bg-sun'];

export function avatarTone(name: string): string {
	let sum = 0;
	for (const letter of name) {
		sum += letter.codePointAt(0) ?? 0;
	}

	return AVATAR_TONES[sum % AVATAR_TONES.length]!;
}
