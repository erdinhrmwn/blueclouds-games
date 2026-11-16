import { describe, expect, test } from "bun:test";
import {
	type BotInput,
	botAccountName,
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
	test("fills a knockout to a perfect bracket from 80%, Arena and Swiss to full tables; at most 5 bots, never below the minimum", () => {
		const arena = { format: "arena" as const };
		const cases: [Partial<BotInput>, number | null][] = [
			// A knockout fills to a perfect bracket once 80% of it signed up.
			[{ registered: 13, people: 13, perTable: 2 }, 16],
			[{ registered: 12, people: 12, perTable: 2 }, null],
			[{ registered: 14, people: 14, perTable: 4 }, 16],
			// Past the maximum, a knockout fills its tables instead.
			[{ registered: 19, people: 19, perTable: 4, maxPlayers: 20 }, 20],
			// Arena and Swiss fill their tables, judged against the maximum.
			[{ ...arena, registered: 7, people: 7 }, 8],
			[{ ...arena, registered: 19, people: 19, maxPlayers: 24 }, null],
			[{ ...arena, registered: 20, people: 20, maxPlayers: 24 }, 20],
			[{ ...arena, registered: 21, people: 21, maxPlayers: 24 }, 24],
			// At most 5 bots: 5 would leave a table of one at 26 people, so 4 make 30.
			[{ registered: 26, people: 26, perTable: 2 }, 30],
			[{ registered: 29, people: 29, perTable: 2 }, 32],
			// Never below the minimum, never for nobody.
			[{ registered: 7, people: 7, perTable: 2, minPlayers: 8 }, null],
			[{ registered: 0, people: 0 }, null],
		];

		for (const [overrides, target] of cases) {
			expect([overrides, botTarget(input(overrides))]).toEqual([overrides, target]);
		}
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

	test("bots are dealt round the tables, at most 2 a table (more if people are short), each table with a person", () => {
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

		// With too few people, tables take more bots, still a person each while they last.
		const fewPeople = spreadBots(
			[
				["b1", "b2", "b3"],
				["b4", "b5", "p1"],
			],
			isBot,
		);

		expect(botsAt(fewPeople)).toEqual([3, 2]);
		expect(fewPeople[1]).toContain("p1");
	});
});
