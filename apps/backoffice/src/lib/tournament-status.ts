/** Where a tournament is in its life, from its timestamps. `bad` marks the ones that need an admin. */
export function tournamentStatus(
	t: { cancelledAt: Date | null; endedAt: Date | null; distributedAt: Date | null; distributeError: string | null; startsAt: Date; registrationOpensAt: Date; registrationClosesAt: Date },
	now = new Date()
): { label: string; bad?: boolean } {
	if (t.cancelledAt) return { label: 'Cancelled' };
	if (t.endedAt) return { label: 'Ended' };
	if (t.distributedAt) return { label: t.startsAt <= now ? 'Playing' : 'Tables handed out' };
	if (t.distributeError) return { label: 'Needs attention', bad: true };
	if (t.registrationClosesAt <= now) return { label: 'Handing out tables' };
	if (t.registrationOpensAt <= now) return { label: 'Sign-up open' };
	return { label: 'Sign-up opens later' };
}

/** "1 h 25 min" between two times, for how long a tournament or a table ran. */
export function duration(from: Date, to: Date): string {
	const min = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
	return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
