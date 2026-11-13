import { describe, expect, test } from "bun:test";
import {
	finalPlaces,
	matchPoints,
	pointsPlaces,
	type RoundSeat,
	swissOrder,
	tableWinners,
} from "./tournament-rounds";

/** Two tables of three in round 1; their winners (a, d) meet in round 2, where d wins. */
const SEATS: RoundSeat[] = [
	{ playerId: "a", round: 1, placement: 1, tableSize: 3 },
	{ playerId: "b", round: 1, placement: 2, tableSize: 3 },
	{ playerId: "c", round: 1, placement: null, tableSize: 0 },
	{ playerId: "d", round: 1, placement: 1, tableSize: 3 },
	{ playerId: "e", round: 1, placement: 3, tableSize: 3 },
	{ playerId: "f", round: 1, placement: 2, tableSize: 3 },
	{ playerId: "a", round: 2, placement: 2, tableSize: 2 },
	{ playerId: "d", round: 2, placement: 1, tableSize: 2 },
];
const SIGN_UP = new Map(["f", "e", "d", "c", "b", "a"].map((id, index) => [id, index]));

describe("tableWinners", () => {
	test("only first places of that round go on", () => {
		expect(tableWinners(SEATS, 1)).toEqual(["a", "d"]);
		expect(tableWinners(SEATS, 2)).toEqual(["d"]);
		expect(tableWinners(SEATS, 3)).toEqual([]);
	});
});

describe("finalPlaces", () => {
	test("further first, then the finish at their last table, then sign-up order", () => {
		const places = finalPlaces(SEATS, SIGN_UP);

		expect(places.map((place) => place.playerId)).toEqual(["d", "a", "f", "b", "e"]);
		expect(places.map((place) => place.place)).toEqual([1, 2, 3, 4, 5]);
		expect(places[0]).toEqual({ playerId: "d", place: 1, wins: 2, points: 0, lastRound: 2 });
		expect(places[1]).toEqual({ playerId: "a", place: 2, wins: 1, points: 0, lastRound: 2 });
	});

	test("a player who never played has no place; a missed later round ranks below that round's players", () => {
		const missedFinal: RoundSeat[] = [
			...SEATS.filter((seat) => seat.round === 1),
			{ playerId: "a", round: 2, placement: 1, tableSize: 2 },
			{ playerId: "d", round: 2, placement: null, tableSize: 0 },
		];
		const places = finalPlaces(missedFinal, SIGN_UP);

		expect(places.map((place) => place.playerId)).toEqual(["a", "d", "f", "b", "e"]);
		expect(places.some((place) => place.playerId === "c")).toBe(false);
	});

	test("the one player left standing is 1st, even level with another table's winner", () => {
		const roundOne = SEATS.filter((seat) => seat.round === 1);

		expect(finalPlaces(roundOne, SIGN_UP)[0]!.playerId).toBe("d");
		expect(finalPlaces(roundOne, SIGN_UP, "a")[0]!.playerId).toBe("a");
	});

	test("nobody seated, nobody ranked", () => {
		expect(finalPlaces([], SIGN_UP)).toEqual([]);
	});
});

describe("points (Arena and Swiss)", () => {
	test("table size minus placement plus one; an unplayed seat scores nothing", () => {
		expect(matchPoints({ playerId: "a", round: 1, placement: 1, tableSize: 6 })).toBe(6);
		expect(matchPoints({ playerId: "a", round: 1, placement: 6, tableSize: 6 })).toBe(1);
		expect(matchPoints({ playerId: "a", round: 1, placement: null, tableSize: 0 })).toBe(0);
	});

	test("most points first, then wins, then average placement, then sign-up order", () => {
		// Round 1: a beats b, c beats d. Round 2: b beats c, d beats a (all tables of two).
		const seats: RoundSeat[] = [
			{ playerId: "a", round: 1, placement: 1, tableSize: 2 },
			{ playerId: "b", round: 1, placement: 2, tableSize: 2 },
			{ playerId: "c", round: 1, placement: 1, tableSize: 2 },
			{ playerId: "d", round: 1, placement: 2, tableSize: 2 },
			{ playerId: "b", round: 2, placement: 1, tableSize: 2 },
			{ playerId: "c", round: 2, placement: 2, tableSize: 2 },
			{ playerId: "d", round: 2, placement: 1, tableSize: 2 },
			{ playerId: "a", round: 2, placement: null, tableSize: 0 },
			{ playerId: "e", round: 1, placement: null, tableSize: 0 },
		];
		const places = pointsPlaces(seats, SIGN_UP);

		// b, c, d have 3 points and one win each; a has 2 points. Level ones go by sign-up order (d, c, b).
		expect(places.map((place) => [place.playerId, place.points])).toEqual([
			["d", 3],
			["c", 3],
			["b", 3],
			["a", 2],
		]);
		expect(places.some((place) => place.playerId === "e")).toBe(false);
	});

	test("Swiss seats players on similar points next to each other", () => {
		const seats: RoundSeat[] = [
			{ playerId: "a", round: 1, placement: 1, tableSize: 2 },
			{ playerId: "b", round: 1, placement: 2, tableSize: 2 },
			{ playerId: "c", round: 1, placement: 1, tableSize: 2 },
			{ playerId: "d", round: 1, placement: 2, tableSize: 2 },
		];

		expect(swissOrder(["a", "b", "c", "d"], seats, SIGN_UP)).toEqual(["c", "a", "d", "b"]);
	});
});
