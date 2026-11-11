import { expect, test } from "bun:test";
import { z } from "zod";
import { buildReport, type MatchState, noteMove, uuidv7 } from "./match";
import { addPlayer, createGame, type Game } from "./rules";

function table(lives: Record<string, number>, winnerId: string | null): Game {
	let g = createGame();
	g = addPlayer(g, "a", "Ann");
	g = addPlayer(g, "bot-1", "Bot Rain", true);
	g = addPlayer(g, "c", "Cy");
	return {
		...g,
		phase: winnerId ? "finished" : "playing",
		winnerId,
		players: g.players.map((p) => ({ ...p, lives: lives[p.id]! })),
	};
}

const start: MatchState = { id: "m1", startedAt: "2026-11-11T10:00:00.000Z", out: [] };

test("placements follow the elimination order, winner first", () => {
	// Cy goes out first; the bot goes out on the final move, which also ends the game.
	let match = noteMove(start, table({ a: 2, "bot-1": 1, c: 0 }, null));
	expect(match.out).toEqual(["c"]);
	const report = buildReport(match, table({ a: 2, "bot-1": 0, c: 0 }, "a"), "ABCD", "2026-11-11T10:05:00.000Z");
	const byWho = Object.fromEntries(report.players.map((p) => [p.playerId ?? p.botName, p]));
	expect(byWho.a).toMatchObject({ placement: 1, score: 2, bot: false });
	expect(byWho["Bot Rain"]).toMatchObject({ placement: 2, playerId: null, bot: true });
	expect(byWho.c).toMatchObject({ placement: 3, score: 0 });
});

test("noteMove does not count a player twice", () => {
	const g = table({ a: 2, "bot-1": 1, c: 0 }, null);
	expect(noteMove(noteMove(start, g), g).out).toEqual(["c"]);
});

test("uuidv7 is a valid, time-ordered UUIDv7", () => {
	const a = uuidv7(1_700_000_000_000);
	const b = uuidv7(1_700_000_000_001);
	expect(z.uuidv7().safeParse(a).success).toBe(true);
	expect(a.slice(0, 13)).toBe("018bcfe5-6800");
	expect(a < b).toBe(true);
});
