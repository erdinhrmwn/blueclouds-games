import { describe, expect, test } from "bun:test";
import { fairRng, matchSeeds, newCommitment, seedsForRound } from "./fair-rng";
import {
	checkMatch,
	checkRound,
	clientSeedOf,
	type MatchSeeds,
	nextNonce,
	proofsFromLog,
	type RoundProof,
	sha256Hex,
} from "./fairness";

const deck = (size: number) => Array.from({ length: size }, (_, index) => ({ id: `c${index}` }));

/** Shuffles a deck of each size in its round, as a room does, and returns what the closed rounds reveal. */
function playShuffles(shuffles: { round: number; size: number }[]): RoundProof[] {
	const next = newCommitment();
	let seeds: MatchSeeds = matchSeeds(next);
	const proofs: RoundProof[] = [];

	const rng = fairRng(
		(round) => {
			const result = seedsForRound(seeds, round);
			seeds = result.seeds;

			if (result.started) {
				const { serverSeed, serverSeedHash } = seeds.current!;
				proofs.push({ matchId: next.matchId, round, serverSeed, serverSeedHash, shuffles: [] });
			}

			return seeds;
		},
		(record) => {
			proofs.at(-1)!.shuffles.push({ nonce: record.nonce, deck: record.deck });
			seeds = { ...seeds, last: { round: record.round, nonce: record.nonce } };
		},
	);

	for (const { round, size } of shuffles) {
		rng.shuffle(deck(size), round);
	}

	return proofs;
}

describe("provably fair shuffles", () => {
	test("the room's shuffles check out, each round with its own revealed seed", async () => {
		const proofs = playShuffles([
			{ round: 1, size: 54 },
			{ round: 1, size: 12 },
			{ round: 1, size: 1 },
			{ round: 2, size: 54 },
		]);

		expect(proofs.map((proof) => proof.shuffles.map((shuffle) => shuffle.nonce))).toEqual([
			[0, 1, 2],
			[0],
		]);
		expect(proofs.at(0)!.serverSeed).not.toBe(proofs.at(1)!.serverSeed);
		expect(await sha256Hex(proofs.at(0)!.serverSeed)).toBe(proofs.at(0)!.serverSeedHash);
		expect((await checkMatch(proofs)).ok).toBe(true);
	});

	test("the same seeds and cards always give the same order, whatever order the cards came in", () => {
		const round1 = { round: 1, roundId: "r", serverSeedHash: "", serverSeed: "0".repeat(64) };
		const seeds: MatchSeeds = {
			matchId: "m",
			current: round1,
			previous: null,
			next: round1,
			last: null,
		};
		const rng = fairRng(
			() => seeds,
			() => {},
		);

		const ordered = rng.shuffle(deck(10), 1).map((card) => card.id);
		const reversed = rng.shuffle(deck(10).reverse(), 1).map((card) => card.id);

		expect(reversed).toEqual(ordered);
		// Pinned: a change here breaks the check of every round already played.
		expect(ordered).toEqual(["c9", "c1", "c4", "c3", "c8", "c6", "c7", "c2", "c5", "c0"]);
	});

	test("a changed card, a skipped nonce or another seed fails the round", async () => {
		const [round] = playShuffles([
			{ round: 1, size: 20 },
			{ round: 1, size: 20 },
		]) as [RoundProof];
		const [first, second] = round.shuffles as [
			RoundProof["shuffles"][0],
			RoundProof["shuffles"][0],
		];

		const swapped = [...second.deck];
		[swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
		const changed = { ...round, shuffles: [first, { ...second, deck: swapped }] };
		expect((await checkRound(changed)).shuffles.map((shuffle) => shuffle.ok)).toEqual([
			true,
			false,
		]);

		const skipped = { ...round, shuffles: [second] };
		expect((await checkRound(skipped)).ok).toBe(false);

		const otherSeed = { ...round, serverSeed: "f".repeat(64) };
		const check = await checkRound(otherSeed);
		expect(check.hashMatches).toBe(false);
		expect(check.ok).toBe(false);
	});

	test("a match's rounds start at 1 and never skip one", async () => {
		const [one, two] = playShuffles([
			{ round: 1, size: 10 },
			{ round: 2, size: 10 },
		]) as [RoundProof, RoundProof];

		expect((await checkMatch([one, two])).ok).toBe(true);
		expect((await checkMatch([two])).rounds.map((round) => round.ok)).toEqual([false]);
		expect((await checkMatch([one, { ...two, round: 3 }])).ok).toBe(false);
	});

	test("a new round starts on the committed seed, which gets a new commitment after it", () => {
		const seeds = matchSeeds(newCommitment());
		const first = seedsForRound(seeds, 1);

		expect(first.started).toBe(true);
		expect(first.seeds.current).toEqual({ ...seeds.next, round: 1 });
		expect(first.seeds.next.serverSeedHash).not.toBe(seeds.next.serverSeedHash);
		expect(seedsForRound(first.seeds, 1)).toEqual({ seeds: first.seeds, started: false });

		const second = seedsForRound(first.seeds, 2);
		expect(second.seeds.current).toEqual({ ...first.seeds.next, round: 2 });
		expect(second.seeds.previous).toEqual(first.seeds.current);
		expect(() => seedsForRound(second.seeds, 4)).toThrow();
	});

	test("the client seed is the match id, round and nonce", () => {
		expect(clientSeedOf("m-1", { round: 2, nonce: 1 })).toBe("m-1:2:1");
	});

	test("the nonce counts up within a round and starts again at 0 in the next", () => {
		expect(nextNonce(null, 1)).toBe(0);
		expect(nextNonce({ round: 1, nonce: 0 }, 1)).toBe(1);
		expect(nextNonce({ round: 1, nonce: 4 }, 2)).toBe(0);
	});

	test("reads each closed round back from a move log; a round still played has no reveal yet", () => {
		const events = [
			{ type: "fairness", data: { round: 1, roundId: "r1", serverSeedHash: "h1" } },
			{ type: "shuffle", data: { round: 1, nonce: 0, deck: ["a", "b"] } },
			{ type: "deal", data: { round: 1 } },
			{ type: "fairness", data: { round: 2, roundId: "r2", serverSeedHash: "h2" } },
			{ type: "shuffle", data: { round: 2, nonce: 0, deck: ["b", "a"] } },
			{ type: "deal", data: { round: 2 } },
			{ type: "reveal", data: { round: 1, serverSeed: "s1" } },
		];

		expect(proofsFromLog("m", events)).toEqual([
			{
				matchId: "m",
				round: 1,
				serverSeed: "s1",
				serverSeedHash: "h1",
				shuffles: [{ nonce: 0, deck: ["a", "b"] }],
			},
		]);
	});
});
