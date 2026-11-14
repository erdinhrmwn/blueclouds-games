import { checkRound, type RoundCheck } from 'server/games/shared/fairness';
import { SUIT_TEXT } from '#lib/games/cloudburst/suits.ts';

/** One event of a round's moves (docs/architecture/match-log.md). */
export type RoundEvent = {
	seq: number;
	t: number;
	type: string;
	seat?: number;
	data?: Record<string, unknown>;
};

/** A closed round as the platform keeps it: its result, its revealed seed and every shuffle. */
export type Round = {
	id: string;
	round: number;
	startedAt: string;
	endedAt: string;
	result: Record<string, unknown>;
	/** Every move from the round's deal on, as the match's move log has them (`t`: ms since the match start). */
	events: RoundEvent[];
	serverSeedHash: string;
	serverSeed: string;
	shuffles: { nonce: number; clientSeed: string; deck: string[] }[];
};

export type MatchRounds = {
	/** `players`: who sat in each seat, once the match is reported. */
	match: { id: string; game: string; finished: boolean; players: { seat: number; name: string }[] };
	rounds: Round[];
};

/** Recomputes a closed round's shuffles in this browser from its revealed seed (docs/architecture/fairness.md). */
export function verifyRound(matchId: string, round: Round): Promise<RoundCheck> {
	return checkRound({
		matchId,
		round: round.round,
		serverSeed: round.serverSeed,
		serverSeedHash: round.serverSeedHash,
		shuffles: round.shuffles
	});
}

/**
 * What a closed round's result says, in words. The result is each game's own summary (rounds.ts in the game
 * server): Bust 31 names the seat that busted, Cloudburst the seat that went out. `nameOf` turns a seat into a
 * name; without one it is "Seat N", counted from 1 as the table shows it.
 */
export function roundSummary(
	game: string,
	result: Record<string, unknown>,
	nameOf: (seat: number) => string | null = () => null
): string {
	const name = (seat: unknown) => {
		const index = Number(seat);
		return nameOf(index) ?? `Seat ${index + 1}`;
	};

	if (game === 'bust-31' && result.seat !== undefined) {
		const lives = Number(result.lives);
		const after = result.eliminated
			? 'out of the match'
			: `${lives} ${lives === 1 ? 'life' : 'lives'} left`;

		return `${name(result.seat)} busted at ${String(result.total)} · ${after}`;
	}

	if (game === 'cloudburst' && result.out !== undefined) {
		return `${name(result.out)} went out first`;
	}

	return 'No result';
}

/** A card of a revealed deck, drawn small: the mark on its face and its ink. */
export type CardFace = { mark: string; spoken: string; ink: string };

const BUST_FACES: Record<string, CardFace> = {
	z: { mark: '0', spoken: 'zero', ink: 'text-[#3d5a6c]' },
	m: { mark: '−5', spoken: 'minus five', ink: 'text-[#2f6b4f]' },
	r: { mark: '⇄', spoken: 'reverse', ink: 'text-[#a8401f]' },
	s: { mark: '⇋', spoken: 'swap', ink: 'text-[#6a3d78]' },
	t: { mark: '10', spoken: 'ten', ink: 'text-ink' },
	d: { mark: '×2', spoken: 'double', ink: 'text-[#2c5f8a]' }
};

const CLOUD_ACTIONS: Record<string, string> = { calm: 'C', swirl: 'S', gust: 'G', downpour: '+2' };

/** A table's own entry for `key`, never one inherited from Object (card ids come from the server). */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
	Object.hasOwn(table, key) ? table[key] : undefined;

/** How a card id looks in a revealed deck: Bust 31 "n7-1" is a 7, Cloudburst "rain-gust-0" a rain G. */
export function cardFace(game: string, id: string): CardFace {
	const parts = id.split('-');
	const head = parts.at(0) ?? '';

	if (game === 'bust-31') {
		const special = own(BUST_FACES, head);
		if (special) {
			return special;
		}

		const value = head.slice(1);
		return { mark: value, spoken: value, ink: 'text-ink' };
	}

	if (head === 'rainbow') {
		return { mark: '✦', spoken: 'rainbow', ink: 'text-ink' };
	}

	if (head === 'tempest') {
		return { mark: '+4', spoken: 'tempest', ink: 'text-ink' };
	}

	const face = parts.at(1) ?? '';
	const ink = own<string>(SUIT_TEXT, head) ?? 'text-ink';
	const mark = own(CLOUD_ACTIONS, face) ?? face;

	return { mark, spoken: `${head} ${face}`, ink };
}
