import { describe, expect, test } from "bun:test";
import { fairRng, newCommitment } from "./fair-rng";
import {
	checkFairness,
	clientSeedOf,
	type MatchSeeds,
	proofFromLog,
	type ShuffleRecord,
	sha256Hex,
} from "./fairness";

const deck = (size: number) => Array.from({ length: size }, (_, index) => ({ id: `c${index}` }));

/** Shuffles `sizes` decks the way a room does and returns the proof a finished match reveals. */
function playShuffles(sizes: number[]) {
	const next = newCommitment();
	let seeds: MatchSeeds = { ...next, clientSeed: clientSeedOf(next.matchId, []), nonce: 0 };
	const records: ShuffleRecord[] = [];
	const rng = fairRng(
		() => seeds,
		(record) => {
			records.push(record);
			seeds = { ...seeds, nonce: seeds.nonce + 1 };
		},
	);

	for (const size of sizes) {
		rng.shuffle(deck(size));
	}

	return {
		serverSeed: next.serverSeed,
		serverSeedHash: next.serverSeedHash,
		clientSeed: seeds.clientSeed,
		shuffles: records,
	};
}

describe("provably fair shuffles", () => {
	test("the room's shuffles check out with the revealed seed", async () => {
		const proof = playShuffles([54, 54, 12, 1]);

		expect(await sha256Hex(proof.serverSeed)).toBe(proof.serverSeedHash);
		expect((await checkFairness(proof)).ok).toBe(true);
	});

	test("the same seeds and cards always give the same order, whatever order the cards came in", () => {
		const seeds: MatchSeeds = {
			matchId: "m",
			serverSeedHash: "",
			serverSeed: "0".repeat(64),
			clientSeed: "m|0:p",
			nonce: 0,
		};
		const rng = fairRng(
			() => seeds,
			() => {},
		);

		const ordered = rng.shuffle(deck(10)).map((card) => card.id);
		const reversed = rng.shuffle(deck(10).reverse()).map((card) => card.id);

		expect(reversed).toEqual(ordered);
		// Pinned: a change here breaks the check of every match already played.
		expect(ordered).toEqual(["c0", "c4", "c3", "c1", "c8", "c5", "c2", "c6", "c9", "c7"]);
	});

	test("a changed card, a skipped nonce or another seed fails the check", async () => {
		const proof = playShuffles([20, 20]);

		const swapped = [...proof.shuffles[1]!.deck];
		[swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
		const changed = { ...proof, shuffles: [proof.shuffles[0]!, { nonce: 1, deck: swapped }] };
		expect((await checkFairness(changed)).shuffles.map((shuffle) => shuffle.ok)).toEqual([
			true,
			false,
		]);

		const skipped = { ...proof, shuffles: [proof.shuffles[1]!] };
		expect((await checkFairness(skipped)).ok).toBe(false);

		const otherSeed = { ...proof, serverSeed: "f".repeat(64) };
		const check = await checkFairness(otherSeed);
		expect(check.hashMatches).toBe(false);
		expect(check.ok).toBe(false);
	});

	test("the client seed is the match id and the seating, in seat order", () => {
		const seats = [
			{ seat: 2, playerId: null, botName: "Bot Rain" },
			{ seat: 0, playerId: "p-1" },
		];

		expect(clientSeedOf("m-1", seats)).toBe("m-1|0:p-1,2:bot:Bot Rain");
	});

	test("reads the proof back from a move log", () => {
		const events = [
			{ type: "fairness", data: { serverSeedHash: "h", clientSeed: "m|0:p" } },
			{ type: "shuffle", data: { nonce: 0, deck: ["a", "b"] } },
			{ type: "deal", data: {} },
			{ type: "reveal", data: { serverSeed: "s" } },
		];

		expect(proofFromLog(events)).toEqual({
			serverSeed: "s",
			serverSeedHash: "h",
			clientSeed: "m|0:p",
			shuffles: [{ nonce: 0, deck: ["a", "b"] }],
		});
		expect(proofFromLog(events.slice(0, 3))).toBeNull();
	});
});
