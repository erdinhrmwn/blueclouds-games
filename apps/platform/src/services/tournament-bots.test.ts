import { describe, expect, test } from "bun:test";
import {
	botAccountName,
	type BotInput,
	botTarget,
	perfectBracket,
	spreadBots,
} from "./tournament-bots";

const input = (overrides: Partial<BotInput>): BotInput => ({
	registered: 0,
	people: 0,
	perTable: 4,
	minPlayers: null,
	maxPlayers: null,
	format: "knockout",
	...overrides,
});

describe("perfectBracket", () => {
	test("tables of the per-table size, raised until everyone fits", () => {
		expect(perfectBracket(13, 2)).toBe(16);
		expect(perfectBracket(16, 2)).toBe(16);
		expect(perfectBracket(5, 4)).toBe(16);
		expect(perfectBracket(3, 4)).toBe(4);
	});
});

describe("botTarget", () => {
	test("a knockout fills to a perfect bracket once 80% of it signed up", () => {
		expect(botTarget(input({ registered: 13, people: 13, perTable: 2 }))).toBe(16);
		expect(botTarget(input({ registered: 12, people: 12, perTable: 2 }))).toBeNull();
		expect(botTarget(input({ registered: 14, people: 14, perTable: 4 }))).toBe(16);
	});

	test("a knockout whose perfect bracket passes the maximum fills its tables instead", () => {
		expect(botTarget(input({ registered: 19, people: 19, perTable: 4, maxPlayers: 20 }))).toBe(20);
	});

	test("Arena and Swiss fill their tables, judged against the maximum", () => {
		const arena = { format: "arena" as const };
		expect(botTarget(input({ ...arena, registered: 7, people: 7 }))).toBe(8);
		expect(botTarget(input({ ...arena, registered: 19, people: 19, maxPlayers: 24 }))).toBeNull();
		expect(botTarget(input({ ...arena, registered: 20, people: 20, maxPlayers: 24 }))).toBe(20);
		expect(botTarget(input({ ...arena, registered: 21, people: 21, maxPlayers: 24 }))).toBe(24);
	});

	test("at most 5 bots, however far the target is", () => {
		// 2 a table, 26 people: the perfect bracket is 32; 5 bots would leave a table of one, so 4 make 30.
		expect(botTarget(input({ registered: 26, people: 26, perTable: 2 }))).toBe(30);
		expect(botTarget(input({ registered: 29, people: 29, perTable: 2 }))).toBe(32);
	});

	test("never below the minimum, never for nobody", () => {
		expect(botTarget(input({ registered: 7, people: 7, perTable: 2, minPlayers: 8 }))).toBeNull();
		expect(botTarget(input({ registered: 0, people: 0 }))).toBeNull();
	});
});

describe("botAccountName", () => {
	test("takes the names in turn, then numbers them", () => {
		expect(botAccountName(0)).toBe("Bot Ash");
		expect(botAccountName(1)).toBe("Bot Bree");
		expect(botAccountName(24)).toBe("Bot Ash 2");
	});
});

describe("spreadBots", () => {
	const isBot = (id: string) => id.startsWith("b");
	const botsAt = (tables: string[][]) => tables.map((table) => table.filter(isBot).length);

	test("bots are dealt round the tables, at most 2 a table, each table with a person", () => {
		const tables = spreadBots(
			[
				["b1", "b2", "b3", "b4"],
				["b5", "p1", "p2", "p3"],
				["p4", "p5", "p6", "p7"],
			],
			isBot,
		);

		expect(botsAt(tables)).toEqual([2, 2, 1]);
		expect(tables.map((table) => table.length)).toEqual([4, 4, 4]);
		expect(tables.flat().sort()).toEqual(
			["b1", "b2", "b3", "b4", "b5", "p1", "p2", "p3", "p4", "p5", "p6", "p7"].sort(),
		);
	});

	test("with too few people, tables take more bots, still a person each while they last", () => {
		const tables = spreadBots(
			[
				["b1", "b2", "b3"],
				["b4", "b5", "p1"],
			],
			isBot,
		);

		expect(botsAt(tables)).toEqual([3, 2]);
		expect(tables[1]).toContain("p1");
	});
});
