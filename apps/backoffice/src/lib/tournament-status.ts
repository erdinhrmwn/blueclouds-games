import dayjs from 'dayjs';
import durationPlugin from 'dayjs/plugin/duration';

dayjs.extend(durationPlugin);

/** How a tournament is played (migration 019). A label for now: every format still plays one round per table. */
export const TOURNAMENT_FORMATS = [
	{ value: 'arena', label: 'Arena', note: 'Most points wins' },
	{ value: 'knockout', label: 'Knockout', note: 'Lose and you’re out' },
	{ value: 'swiss', label: 'Swiss', note: 'Paired by score' }
] as const;

export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number]['value'];

/** "Knockout · Lose and you’re out". */
export function formatLabel(value: TournamentFormat): string {
	const format = TOURNAMENT_FORMATS.find((entry) => entry.value === value);
	if (!format) return value;

	return `${format.label} · ${format.note}`;
}

/** `bad` marks the ones that need an admin, `running` the ones players can sign up for or are playing in. */
export type TournamentStatus = { label: string; bad?: boolean; running?: boolean };

/** Where a tournament is in its life, from its timestamps. */
export function tournamentStatus(
	tournament: {
		cancelledAt: Date | null;
		endedAt: Date | null;
		distributedAt: Date | null;
		distributeError: string | null;
		startsAt: Date;
		registrationOpensAt: Date;
		registrationClosesAt: Date;
	},
	now = new Date()
): TournamentStatus {
	if (tournament.cancelledAt) return { label: 'Cancelled' };
	if (tournament.endedAt) return { label: 'Ended' };

	if (tournament.distributedAt) {
		const started = tournament.startsAt <= now;
		return started ? { label: 'Playing', running: true } : { label: 'Tables handed out' };
	}

	if (tournament.distributeError) return { label: 'Needs attention', bad: true };
	if (tournament.registrationClosesAt <= now) return { label: 'Handing out tables' };
	if (tournament.registrationOpensAt <= now) return { label: 'Sign-up open', running: true };

	return { label: 'Sign-up opens later' };
}

/** "42 sec", "3 min 5 sec" or "1 h 25 min" between two times, for how long a tournament or a table ran. */
export function duration(from: Date, to: Date): string {
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

/** The pill for a status: red when it needs an admin, green while it's running, plain otherwise. */
export function statusTag(status: TournamentStatus): string {
	if (status.bad) return 'tag-bad';
	if (status.running) return 'tag-good';

	return 'tag';
}
