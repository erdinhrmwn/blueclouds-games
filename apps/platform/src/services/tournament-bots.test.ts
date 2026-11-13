import { describe, expect, test } from "bun:test";
import {
	botAccountName,
	type BotInput,
	botTarget,
	perfectBracket,
	spreadPeople,
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

describe("spreadPeople", () => {
	test("a table of only bots gets a person from a table with two or more", () => {
		const isBot = (id: string) => id.startsWith("b");
		const tables = spreadPeople(
			[
				["p1", "p2", "b1"],
				["b2", "b3", "b4"],
			],
			isBot,
		);

		expect(tables.every((table) => table.some((id) => !isBot(id)))).toBe(true);
		expect(tables.flat().sort()).toEqual(["b1", "b2", "b3", "b4", "p1", "p2"]);
	});

	test("with fewer people than tables, some tables stay bots only", () => {
		const isBot = (id: string) => id.startsWith("b");
		const tables = spreadPeople(
			[
				["b1", "b2"],
				["p1", "b3"],
			],
			isBot,
		);

		expect(tables).toEqual([
			["b1", "b2"],
			["p1", "b3"],
		]);
	});
});
