/**
 * The rules that move a tournament from one round to the next and rank it at the end, as pure functions over who
 * sat in which round and where they finished (docs/plans/tournament-rounds.md). The job in ./tournaments.ts reads
 * the rows, asks these, and writes the answer.
 *
 * Until phase 3 every format plays as a knockout: each table's winner goes on, until one player is left.
 */

/** One player's seat in one round, and where they finished at that table; null when they didn't play it. */
export type RoundSeat = {
	playerId: string;
	round: number;
	placement: number | null;
};

export type FinalPlace = {
	playerId: string;
	place: number;
	/** Tables won across every round. */
	wins: number;
	/** The furthest round they were seated in. */
	lastRound: number;
};

/** The players who won their table in this round: they play the next one. */
export function tableWinners(seats: RoundSeat[], round: number): string[] {
	return seats
		.filter((seat) => seat.round === round && seat.placement === 1)
		.map((seat) => seat.playerId);
}

/**
 * Final places for a knockout. Whoever got further ranks higher; in the same round, a better finish at their table
 * ranks higher, and a seat they didn't play ranks below every played one; a player who never played a match gets
 * no place. Players still level (say 2nd at two different tables) are split by sign-up order, earliest first, so
 * every place is taken once.
 */
export function finalPlaces(
	seats: RoundSeat[],
	signUpOrder: Map<string, number>,
	/** The one player left standing, when the last round left exactly one: 1st whatever the rest says. */
	championId: string | null = null,
): FinalPlace[] {
	type Run = {
		playerId: string;
		lastRound: number;
		lastPlacement: number | null;
		wins: number;
		played: boolean;
	};
	const runs = new Map<string, Run>();

	for (const seat of seats) {
		const run = runs.get(seat.playerId) ?? {
			playerId: seat.playerId,
			lastRound: 0,
			lastPlacement: null,
			wins: 0,
			played: false,
		};

		if (seat.placement !== null) {
			run.played = true;
		}

		if (seat.placement === 1) {
			run.wins += 1;
		}

		if (seat.round > run.lastRound) {
			run.lastRound = seat.round;
			run.lastPlacement = seat.placement;
		}

		runs.set(seat.playerId, run);
	}

	const unplayed = Number.POSITIVE_INFINITY;
	const lastInLine = Number.MAX_SAFE_INTEGER;

	// Someone who never played a match has no place; a later unplayed seat still ranks below that round's players.
	const ranked = [...runs.values()]
		.filter((run) => run.played)
		.sort((a, b) => {
			if (a.playerId === championId || b.playerId === championId) {
				return a.playerId === championId ? -1 : 1;
			}

			if (a.lastRound !== b.lastRound) {
				return b.lastRound - a.lastRound;
			}

			const placementA = a.lastPlacement ?? unplayed;
			const placementB = b.lastPlacement ?? unplayed;
			if (placementA !== placementB) {
				return placementA - placementB;
			}

			const orderA = signUpOrder.get(a.playerId) ?? lastInLine;
			const orderB = signUpOrder.get(b.playerId) ?? lastInLine;
			return orderA - orderB;
		});

	return ranked.map((run, index) => ({
		playerId: run.playerId,
		place: index + 1,
		wins: run.wins,
		lastRound: run.lastRound,
	}));
}
