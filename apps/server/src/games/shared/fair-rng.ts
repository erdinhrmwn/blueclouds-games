// The room's side of provably fair shuffles: makes the seeds and shuffles with them, synchronously (the game rules
// shuffle mid-move). Same numbers as checkRound in fairness.ts, which a test holds it to.
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
	blockMessage,
	blocksFor,
	canonical,
	clientSeedOf,
	fisherYates,
	floatsNeeded,
	floatsOf,
	type MatchSeeds,
	nextNonce,
	type RoundSeed,
	type ShuffleRecord,
} from "./fairness";
import { uuidv7 } from "./match";
import type { Rng } from "./table";

/** The next match, fixed before anyone sits down for it: its id and the commitment of its first round. */
export type NextMatch = { matchId: string; firstRound: RoundSeed };

const SERVER_SEED_BYTES = 32;

/** A new round's id and server seed, with the hash the table shows before the round is dealt. */
export function newRoundSeed(): RoundSeed {
	const serverSeed = randomBytes(SERVER_SEED_BYTES).toString("hex");
	const serverSeedHash = createHash("sha256").update(serverSeed).digest("hex");

	return { roundId: uuidv7(), serverSeed, serverSeedHash };
}

export function newCommitment(): NextMatch {
	return { matchId: uuidv7(), firstRound: newRoundSeed() };
}

/** A match's seeds before its first deal: round 1 plays on the commitment the table showed in the lobby. */
export function matchSeeds(next: NextMatch): MatchSeeds {
	return {
		matchId: next.matchId,
		current: null,
		previous: null,
		next: next.firstRound,
		last: null,
	};
}

/**
 * The seeds for a shuffle in `round`. The round being played keeps its seed; the round after it starts on the
 * committed next one, which then gets a new commitment of its own (`started` says so, for the log). Any other
 * round is a bug in the rules: rounds never skip or go back.
 */
export function seedsForRound(
	seeds: MatchSeeds,
	round: number,
): { seeds: MatchSeeds; started: boolean } {
	if (seeds.current?.round === round) {
		return { seeds, started: false };
	}

	const expected = (seeds.current?.round ?? 0) + 1;
	if (round !== expected) {
		throw new Error(`A shuffle in round ${round} while round ${expected - 1} is played.`);
	}

	const started: MatchSeeds = {
		...seeds,
		current: { ...seeds.next, round },
		previous: seeds.current,
		next: newRoundSeed(),
	};

	return { seeds: started, started: true };
}

function floatsFor(serverSeed: string, clientSeed: string, count: number): number[] {
	const floats: number[] = [];

	for (let block = 0; block < blocksFor(count); block += 1) {
		const digest = createHmac("sha256", serverSeed)
			.update(blockMessage(clientSeed, block))
			.digest();
		floats.push(...floatsOf(digest));
	}

	return floats;
}

/**
 * Shuffles with the match's seeds. `seedsFor(round)` gives the seeds of that round (starting it if it is new);
 * `done` is told each shuffle so the caller can keep it as the last one and log it.
 */
export function fairRng(
	seedsFor: (round: number) => MatchSeeds,
	done: (record: ShuffleRecord) => void,
): Rng {
	return {
		shuffle: (items, round) => {
			const seeds = seedsFor(round);
			const key = { round, nonce: nextNonce(seeds.last, round) };
			const clientSeed = clientSeedOf(seeds.matchId, key);
			const cards = canonical(items);
			const floats = floatsFor(seeds.current!.serverSeed, clientSeed, floatsNeeded(cards.length));
			const out = fisherYates(cards, floats);

			done({ ...key, deck: out.map((card) => card.id) });
			return out;
		},
	};
}
