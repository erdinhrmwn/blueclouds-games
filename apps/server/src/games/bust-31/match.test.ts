import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { chooseBotCard } from "./bots";
import { buildReport, type LogEntry, logEvents, type MatchState, noteMove, stamp, uuidv7 } from "./match";
import { addPlayer, type Card, createGame, type Game, playCard, setAway, startGame } from "./rules";

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

const start: MatchState = { id: "m1", startedAt: "2026-11-11T10:00:00.000Z", out: [], seq: 0 };

test("placements follow the elimination order, winner first", () => {
	// Cy goes out first; the bot goes out on the final move, which also ends the game.
	let match = noteMove(start, table({ a: 2, "bot-1": 1, c: 0 }, null));
	expect(match.out).toEqual(["c"]);
	const report = buildReport(match, table({ a: 2, "bot-1": 0, c: 0 }, "a"), "ABCD", "2026-11-11T10:05:00.000Z", []);
	const byWho = Object.fromEntries(report.players.map((p) => [p.playerId ?? p.botName, p]));
	expect(byWho.a).toMatchObject({ placement: 1, livesLeft: 2, bot: false });
	expect(byWho["Bot Rain"]).toMatchObject({ placement: 2, playerId: null, bot: true });
	expect(byWho.c).toMatchObject({ placement: 3, livesLeft: 0 });
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

const rng = () => 0.42;
const card = (kind: Card["kind"], value: number, id: string): Card => ({ id, kind, value });

/** Two players, Ann to move with a fixed hand. */
function started(): Game {
	let g = createGame();
	g = addPlayer(g, "a", "Ann");
	g = addPlayer(g, "bot-1", "Bot Rain", true);
	return startGame(g, "a", rng);
}
const withHand = (g: Game, hand: Card[], total = g.total): Game => ({
	...g,
	total,
	players: g.players.map((p, i) => (i === g.turn ? { ...p, hand } : p)),
});

describe("logEvents", () => {
	test("start deals: every alive hand and the deck order", () => {
		const lobby = addPlayer(addPlayer(createGame(), "a", "Ann"), "bot-1", "Bot Rain", true);
		const g = startGame(lobby, "a", rng);
		const [deal] = logEvents(lobby, g);
		expect(deal).toEqual({
			type: "deal",
			data: {
				round: 1,
				starter: 0,
				hands: { 0: g.players[0]!.hand.map((c) => c.id), 1: g.players[1]!.hand.map((c) => c.id) },
				deck: g.deck.map((c) => c.id),
			},
		});
	});

	test("a play records the card, the new total and the card drawn", () => {
		const g = withHand(started(), [card("number", 7, "n7-0")], 10);
		const next = playCard(g, "a", "n7-0", rng);
		expect(logEvents(g, next)).toEqual([
			{ type: "play", seat: 0, data: { card: "n7-0", total: 17, drew: g.deck[0]!.id, by: "player" } },
		]);
		expect(logEvents(g, next, true)[0]!.data!.by).toBe("timeout");
	});

	test("an empty deck logs the reshuffle before the play", () => {
		const g = { ...withHand(started(), [card("number", 2, "n2-0")]), deck: [], discard: [card("number", 5, "n5-0"), card("number", 6, "n6-0")] };
		const entries = logEvents(g, playCard(g, "a", "n2-0", rng));
		expect(entries.map((e) => e.type)).toEqual(["reshuffle", "play"]);
		expect([...(entries[0]!.data!.deck as string[])].sort()).toEqual(["n5-0", "n6-0"]);
		expect(entries[1]!.data!.drew).toBe((entries[0]!.data!.deck as string[])[0]);
	});

	test("a bust is followed by the new deal; the last bust ends the match", () => {
		const g = withHand(started(), [card("number", 9, "n9-0")], 30);
		const next = playCard(g, "a", "n9-0", rng);
		expect(logEvents(g, next).map((e) => e.type)).toEqual(["bust", "deal"]);
		expect(logEvents(g, next)[0]).toEqual({
			type: "bust",
			seat: 0,
			data: { card: "n9-0", total: 39, lives: 2, eliminated: false, by: "player" },
		});

		const last = { ...g, players: g.players.map((p) => (p.id === "a" ? { ...p, lives: 1 } : p)) };
		const end = playCard(last, "a", "n9-0", rng);
		expect(logEvents(last, end, true)).toEqual([
			{ type: "bust", seat: 0, data: { card: "n9-0", total: 39, lives: 0, eliminated: true, by: "timeout" } },
			{ type: "finished", data: { winner: 1 } },
		]);
	});

	test("bots, away players and lobby changes", () => {
		const g = started();
		const away = setAway(g, "a", true);
		expect(logEvents(g, away)).toEqual([{ type: "away", seat: 0 }]);
		expect(logEvents(away, setAway(away, "a", false))).toEqual([{ type: "back", seat: 0 }]);
		const botTurn = { ...g, turn: 1 };
		const bot = botTurn.players[1]!;
		const played = playCard(botTurn, bot.id, chooseBotCard(bot.hand, 0)!.id, rng);
		expect(logEvents(botTurn, played, true)[0]!.data!.by).toBe("bot");
		expect(logEvents(createGame(), addPlayer(createGame(), "a", "Ann"))).toEqual([]);
	});

	test("a whole bot game logs every move in order", () => {
		let g = createGame();
		g = addPlayer(g, "a", "Ann");
		for (let i = 1; i < 6; i++) g = addPlayer(g, `bot-${i}`, `Bot ${i}`, true);
		const entries: LogEntry[] = [];
		const step = (next: Game) => {
			entries.push(...logEvents(g, next, true));
			g = next;
		};
		step(startGame(g, "a", Math.random));
		while (g.phase === "playing") {
			const p = g.players[g.turn]!;
			step(playCard(g, p.id, chooseBotCard(p.hand, g.total)!.id, Math.random));
		}
		const count = (type: string) => entries.filter((e) => e.type === type).length;
		expect(count("deal")).toBe(g.round);
		expect(count("bust")).toBe(g.players.reduce((n, p) => n + 3 - Math.max(0, p.lives), 0));
		expect(entries.at(-1)).toEqual({ type: "finished", data: { winner: g.players.find((p) => p.id === g.winnerId)!.seat } });
		expect(JSON.stringify(entries).length).toBeLessThan(100_000);
	});
});

test("stamp numbers events after the ones already logged", () => {
	const match = { ...start, seq: 4 };
	const { match: next, events } = stamp(match, [{ type: "a" }, { type: "b" }], Date.parse(start.startedAt) + 1500);
	expect(events).toEqual([
		{ seq: 4, t: 1500, type: "a" },
		{ seq: 5, t: 1500, type: "b" },
	]);
	expect(next.seq).toBe(6);
	expect(stamp(match, [{ type: "a" }], 0).events[0]!.t).toBe(0); // clock stepped back
});
