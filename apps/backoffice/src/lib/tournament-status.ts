/** Where a tournament is in its life, from its timestamps. `bad` marks the ones that need an admin. */
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
): { label: string; bad?: boolean } {
	if (tournament.cancelledAt) return { label: 'Cancelled' };
	if (tournament.endedAt) return { label: 'Ended' };

	if (tournament.distributedAt) {
		const started = tournament.startsAt <= now;
		return { label: started ? 'Playing' : 'Tables handed out' };
	}

	if (tournament.distributeError) return { label: 'Needs attention', bad: true };
	if (tournament.registrationClosesAt <= now) return { label: 'Handing out tables' };
	if (tournament.registrationOpensAt <= now) return { label: 'Sign-up open' };

	return { label: 'Sign-up opens later' };
}

/** "1 h 25 min" between two times, for how long a tournament or a table ran. */
export function duration(from: Date, to: Date): string {
	const elapsedMs = to.getTime() - from.getTime();
	const minutes = Math.max(0, Math.round(elapsedMs / 60_000));
	if (minutes < 60) return `${minutes} min`;

	const hours = Math.floor(minutes / 60);
	return `${hours} h ${minutes % 60} min`;
}
