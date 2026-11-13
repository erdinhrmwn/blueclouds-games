/**
 * The rules that move a tournament from one round to the next and rank it at the end, as pure functions over who
 * sat in which round and where they finished (docs/plans/tournament-rounds.md). The job in ./tournaments.ts reads
 * the rows, asks these, and writes the answer.
 *
 * Knockout: each table's winner goes on, until one player is left. Arena and Swiss: everyone still in plays a fixed
 * number of rounds and scores points by placement; Arena reshuffles every round, Swiss seats players on similar
 * points together.
 */

/** One player's seat in one round, and where they finished at that table; null when they didn't play it. */
export type RoundSeat = {
	playerId: string;
	round: number;
	placement: number | null;
	/** How many players finished that table's match; 0 when it wasn't played. */
	tableSize: number;
};

export type FinalPlace = {
	playerId: string;
	place: number;
	/** Tables won across every round. */
	wins: number;
	/** Arena and Swiss points across every round; 0 in a knockout. */
	points: number;
	/** The furthest round they were seated in. */
	lastRound: number;
};

/**
 * Points for one match (Erdin, 2026-11-13): table size − placement + 1, so a 6-player table gives 6, 5, 4, 3, 2, 1.
 * A seat they didn't play scores nothing.
 */
export function matchPoints(seat: RoundSeat): number {
	if (seat.placement === null) {
		return 0;
	}

	return Math.max(seat.tableSize - seat.placement + 1, 0);
}

/** Running totals per player across every round played so far. */
type Tally = { playerId: string; points: number; wins: number; placements: number[] };

function tally(seats: RoundSeat[]): Map<string, Tally> {
	const totals = new Map<string, Tally>();

	for (const seat of seats) {
		const total = totals.get(seat.playerId) ?? {
			playerId: seat.playerId,
			points: 0,
			wins: 0,
			placements: [],
		};

		total.points += matchPoints(seat);

		if (seat.placement !== null) {
			total.placements.push(seat.placement);
		}

		if (seat.placement === 1) {
			total.wins += 1;
		}

		totals.set(seat.playerId, total);
	}

	return totals;
}

const average = (values: number[]) =>
	values.length === 0
		? Number.POSITIVE_INFINITY
		: values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Arena and Swiss order: most points; then most wins; then the better average placement; then sign-up order.
 * Players who never played a match aren't ranked.
 */
export function pointsPlaces(seats: RoundSeat[], signUpOrder: Map<string, number>): FinalPlace[] {
	const lastInLine = Number.MAX_SAFE_INTEGER;
	const lastRound = new Map<string, number>();
	for (const seat of seats) {
		lastRound.set(seat.playerId, Math.max(lastRound.get(seat.playerId) ?? 0, seat.round));
	}

	const ranked = [...tally(seats).values()]
		.filter((total) => total.placements.length > 0)
		.sort((a, b) => {
			if (a.points !== b.points) {
				return b.points - a.points;
			}

			if (a.wins !== b.wins) {
				return b.wins - a.wins;
			}

			const averageA = average(a.placements);
			const averageB = average(b.placements);
			if (averageA !== averageB) {
				return averageA - averageB;
			}

			const orderA = signUpOrder.get(a.playerId) ?? lastInLine;
			const orderB = signUpOrder.get(b.playerId) ?? lastInLine;
			return orderA - orderB;
		});

	return ranked.map((total, index) => ({
		playerId: total.playerId,
		place: index + 1,
		wins: total.wins,
		points: total.points,
		lastRound: lastRound.get(total.playerId) ?? 1,
	}));
}

/**
 * Swiss seating: players ordered by points so far (most first, then sign-up order), so cutting the list into tables
 * in order puts players on similar points together. Anyone without a seat yet counts as 0.
 */
export function swissOrder(
	players: string[],
	seats: RoundSeat[],
	signUpOrder: Map<string, number>,
): string[] {
	const totals = tally(seats);
	const lastInLine = Number.MAX_SAFE_INTEGER;
	const pointsOf = (playerId: string) => totals.get(playerId)?.points ?? 0;

	return [...players].sort((a, b) => {
		const difference = pointsOf(b) - pointsOf(a);
		if (difference !== 0) {
			return difference;
		}

		return (signUpOrder.get(a) ?? lastInLine) - (signUpOrder.get(b) ?? lastInLine);
	});
}

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
		points: 0,
		lastRound: run.lastRound,
	}));
}
