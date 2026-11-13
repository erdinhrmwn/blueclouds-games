// The room's side of provably fair shuffles: makes the seeds and shuffles with them, synchronously (the game rules
// shuffle mid-move). Same numbers as checkFairness in fairness.ts, which a test holds it to.
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
	blockMessage,
	blocksFor,
	canonical,
	type Commitment,
	fisherYates,
	floatsNeeded,
	floatsOf,
	type MatchSeeds,
	type ShuffleRecord,
} from "./fairness";
import { uuidv7 } from "./match";
import type { Rng } from "./table";

/** The next match, fixed before anyone sits down for it: its id and its server seed. */
export type NextMatch = Commitment & { serverSeed: string };

const SERVER_SEED_BYTES = 32;

export function newCommitment(): NextMatch {
	const serverSeed = randomBytes(SERVER_SEED_BYTES).toString("hex");
	const serverSeedHash = createHash("sha256").update(serverSeed).digest("hex");

	return { matchId: uuidv7(), serverSeed, serverSeedHash };
}

function floatsFor(seeds: MatchSeeds, count: number): number[] {
	const floats: number[] = [];

	for (let block = 0; block < blocksFor(count); block += 1) {
		const digest = createHmac("sha256", seeds.serverSeed)
			.update(blockMessage(seeds.clientSeed, seeds.nonce, block))
			.digest();
		floats.push(...floatsOf(digest));
	}

	return floats;
}

/**
 * Shuffles with the match's seeds. `seeds()` reads the current ones; `done` is told each shuffle so the caller
 * can count the nonce up and log it.
 */
export function fairRng(seeds: () => MatchSeeds, done: (record: ShuffleRecord) => void): Rng {
	return {
		shuffle: (items) => {
			const current = seeds();
			const cards = canonical(items);
			const out = fisherYates(cards, floatsFor(current, floatsNeeded(cards.length)));

			done({ nonce: current.nonce, deck: out.map((card) => card.id) });
			return out;
		},
	};
}
