import { describe, expect, test } from "bun:test";
import { closedRounds, roundReport } from "./rounds";

const event = (seq: number, t: number, type: string, data?: Record<string, unknown>) => ({
	seq,
	t,
	type,
	data,
});

// Round 2's commitment and shuffle are logged before round 1's bust: the room logs a commit's fairness entries
// before its moves, and a round's reveal after them.
const log = [
	event(0, 0, "fairness", { round: 1, roundId: "r1", serverSeedHash: "h1" }),
	event(1, 0, "shuffle", { round: 1, nonce: 0, deck: ["a", "b"] }),
	event(2, 0, "deal", { round: 1 }),
	event(3, 5000, "shuffle", { round: 1, nonce: 1, deck: ["b"] }),
	event(4, 5000, "play", { card: "a" }),
	event(5, 9000, "fairness", { round: 2, roundId: "r2", serverSeedHash: "h2" }),
	event(6, 9000, "shuffle", { round: 2, nonce: 0, deck: ["b", "a"] }),
	{ ...event(7, 9000, "bust", { total: 33 }), seat: 2 },
	event(8, 9000, "deal", { round: 2 }),
	event(9, 9000, "reveal", { round: 1, serverSeed: "s1" }),
	event(10, 12000, "finished", { winner: 0 }),
];

const match = { id: "m", game: "bust-31", roomCode: "R1", startedAt: "2026-11-13T08:00:00.000Z" };
const bustOf = (events: { type: string; seat?: number }[]) => ({
	seat: events.find((e) => e.type === "bust")?.seat ?? null,
});

describe("round history", () => {
	test("a new deal closes the round before it; the end of the match closes the round being played", () => {
		expect(closedRounds(log.slice(7, 9), 2, false)).toEqual([1]);
		expect(closedRounds(log.slice(0, 3), 1, false)).toEqual([]);
		expect(closedRounds(log.slice(10), 2, true)).toEqual([2]);
		expect(closedRounds(log.slice(10), null, true)).toEqual([]);
	});

	test("a closed round holds its seed, its shuffles with their client seeds, its result and times", () => {
		expect(roundReport(log, 1, match, bustOf)).toEqual({
			roundId: "r1",
			game: "bust-31",
			roomCode: "R1",
			round: 1,
			serverSeedHash: "h1",
			serverSeed: "s1",
			shuffles: [
				{ nonce: 0, clientSeed: "m:1:0", deck: ["a", "b"] },
				{ nonce: 1, clientSeed: "m:1:1", deck: ["b"] },
			],
			result: { seat: 2 },
			events: [log[2]!, log[4]!, log[7]!],
			startedAt: "2026-11-13T08:00:00.000Z",
			endedAt: "2026-11-13T08:00:09.000Z",
		});
	});

	test("a round without its reveal or its deal is not reported", () => {
		expect(roundReport(log, 2, match, bustOf)).toBeNull();
		expect(roundReport(log, 3, match, bustOf)).toBeNull();
	});
});
