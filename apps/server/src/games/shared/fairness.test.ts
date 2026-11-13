import { describe, expect, test } from "bun:test";
import { fairRng, newCommitment } from "./fair-rng";
import {
	checkFairness,
	clientSeedOf,
	type MatchSeeds,
	nextNonce,
	proofFromLog,
	type ShuffleRecord,
	sha256Hex,
} from "./fairness";

const deck = (size: number) => Array.from({ length: size }, (_, index) => ({ id: `c${index}` }));

/** Shuffles a deck of each size in its round, as a room does, and returns the proof a finished match reveals. */
function playShuffles(shuffles: { round: number; size: number }[]) {
	const next = newCommitment();
	let seeds: MatchSeeds = { ...next, last: null };
	const records: ShuffleRecord[] = [];
	const rng = fairRng(
		() => seeds,
		(record) => {
			records.push(record);
			seeds = { ...seeds, last: record };
		},
	);

	for (const { round, size } of shuffles) {
		rng.shuffle(deck(size), round);
	}

	return {
		matchId: next.matchId,
		serverSeed: next.serverSeed,
		serverSeedHash: next.serverSeedHash,
		shuffles: records,
	};
}

describe("provably fair shuffles", () => {
	test("the room's shuffles check out with the revealed seed", async () => {
		const proof = playShuffles([
			{ round: 1, size: 54 },
			{ round: 1, size: 12 },
			{ round: 1, size: 1 },
			{ round: 2, size: 54 },
		]);

		expect(proof.shuffles.map((shuffle) => shuffle.nonce)).toEqual([0, 1, 2, 0]);
		expect(await sha256Hex(proof.serverSeed)).toBe(proof.serverSeedHash);
		expect((await checkFairness(proof)).ok).toBe(true);
	});

	test("the same seeds and cards always give the same order, whatever order the cards came in", () => {
		const seeds: MatchSeeds = {
			matchId: "m",
			serverSeedHash: "",
			serverSeed: "0".repeat(64),
			last: null,
		};
		const rng = fairRng(
			() => seeds,
			() => {},
		);
		const ordered = rng.shuffle(deck(10), 1).map((card) => card.id);
		const reversed = rng.shuffle(deck(10).reverse(), 1).map((card) => card.id);

		expect(reversed).toEqual(ordered);
		// Pinned: a change here breaks the check of every match already played.
		expect(ordered).toEqual(["c9", "c1", "c4", "c3", "c8", "c6", "c7", "c2", "c5", "c0"]);
	});

	test("a changed card, a skipped nonce or another seed fails the check", async () => {
		const proof = playShuffles([
			{ round: 1, size: 20 },
			{ round: 1, size: 20 },
		]);
		const [first, second] = proof.shuffles as [ShuffleRecord, ShuffleRecord];

		const swapped = [...second.deck];
		[swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
		const changed = { ...proof, shuffles: [first, { ...second, deck: swapped }] };
		expect((await checkFairness(changed)).shuffles.map((shuffle) => shuffle.ok)).toEqual([
			true,
			false,
		]);

		const skipped = { ...proof, shuffles: [second] };
		expect((await checkFairness(skipped)).ok).toBe(false);

		const otherSeed = { ...proof, serverSeed: "f".repeat(64) };
		const check = await checkFairness(otherSeed);
		expect(check.hashMatches).toBe(false);
		expect(check.ok).toBe(false);
	});

	test("a round never goes back", async () => {
		const proof = playShuffles([
			{ round: 2, size: 10 },
			{ round: 1, size: 10 },
		]);

		expect((await checkFairness(proof)).shuffles.map((shuffle) => shuffle.ok)).toEqual([
			true,
			false,
		]);
	});

	test("the client seed is the match id, round and nonce", () => {
		expect(clientSeedOf("m-1", { round: 2, nonce: 1 })).toBe("m-1:2:1");
	});

	test("the nonce counts up within a round and starts again at 0 in the next", () => {
		expect(nextNonce(null, 1)).toBe(0);
		expect(nextNonce({ round: 1, nonce: 0 }, 1)).toBe(1);
		expect(nextNonce({ round: 1, nonce: 4 }, 2)).toBe(0);
	});

	test("reads the proof back from a move log", () => {
		const events = [
			{ type: "fairness", data: { serverSeedHash: "h" } },
			{ type: "shuffle", data: { round: 1, nonce: 0, deck: ["a", "b"] } },
			{ type: "deal", data: {} },
			{ type: "reveal", data: { serverSeed: "s" } },
		];

		expect(proofFromLog("m", events)).toEqual({
			matchId: "m",
			serverSeedHash: "h",
			serverSeed: "s",
			shuffles: [{ round: 1, nonce: 0, deck: ["a", "b"] }],
		});
		expect(proofFromLog("m", events.slice(0, 3))).toBeNull();
	});
});
