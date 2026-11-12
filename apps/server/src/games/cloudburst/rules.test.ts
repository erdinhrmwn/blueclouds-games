import { describe, expect, test } from "bun:test";
import { chooseBotMove } from "./bots";
import { buildReport, logEvents } from "./match";
import type { LogEntry } from "../shared/match";
import {
	addPlayer,
	BURST_AT,
	buildDeck,
	type Card,
	createGame,
	drawCard,
	fits,
	type Game,
	HAND_SIZE,
	handOf,
	pass,
	placements,
	playCard,
	publicView,
	resetToLobby,
	startGame,
} from "./rules";
import { RuleError } from "../shared/table";

const rng = () => 0.42;
const num = (suit: Card["suit"], value: number, copy = 0): Card => ({
	id: `${suit}-${value}-${copy}`,
	kind: "number",
	suit,
	value,
});
const act = (suit: Card["suit"], kind: "calm" | "swirl" | "gust", copy = 0): Card => ({
	id: `${suit}-${kind}-${copy}`,
	kind,
	suit,
	value: 0,
});
const rainbow: Card = { id: "rainbow-0", kind: "rainbow", suit: null, value: 0 };

function table(n = 3): Game {
	let g = createGame();
	["a", "b", "c", "d"].slice(0, n).forEach((id) => (g = addPlayer(g, id, id.toUpperCase())));
	return startGame(g, "a", rng);
}

/** Sets hands (by player index), the pile top and the suit, so a test controls the play. */
function setup(g: Game, hands: Card[][], top: Card, suit = top.suit!): Game {
	return {
		...g,
		players: g.players.map((p, i) => ({ ...p, hand: hands[i] ?? p.hand })),
		discard: [top],
		suit,
	};
}

describe("deck and fitting", () => {
	test("92 cards with unique ids", () => {
		const deck = buildDeck();
		expect(deck).toHaveLength(92);
		expect(new Set(deck.map((c) => c.id)).size).toBe(92);
		expect(deck.filter((c) => c.kind === "rainbow")).toHaveLength(4);
	});

	test("same suit, one step, same action or Rainbow fit; a same number alone does not", () => {
		const top = num("sun", 5);
		expect(fits(num("sun", 1), top, "sun")).toBe(true);
		expect(fits(num("rain", 4), top, "sun")).toBe(true);
		expect(fits(num("rain", 6), top, "sun")).toBe(true);
		expect(fits(num("rain", 5), top, "sun")).toBe(false);
		expect(fits(num("rain", 7), top, "sun")).toBe(false);
		expect(fits(rainbow, top, "sun")).toBe(true);
		expect(fits(act("rain", "calm"), act("sun", "calm"), "sun")).toBe(true);
		expect(fits(act("rain", "calm"), act("sun", "gust"), "sun")).toBe(false);
		// After a Rainbow only the chosen suit fits (no number to step from).
		expect(fits(num("wind", 2), rainbow, "rain")).toBe(false);
		expect(fits(num("rain", 2), rainbow, "rain")).toBe(true);
	});
});

describe("a round", () => {
	test("start deals 7 each, turns a non-Rainbow card up, first seat starts", () => {
		const g = table();
		expect(g.players.every((p) => p.hand.length === HAND_SIZE)).toBe(true);
		expect(g.discard).toHaveLength(1);
		expect(g.discard[0]!.kind).not.toBe("rainbow");
		expect(g.suit).toBe(g.discard[0]!.suit!);
		expect(g.turn).toBe(0);
		expect(g.round).toBe(1);
	});

	test("playing a fitting card moves the turn on; a wrong card or turn is refused", () => {
		let g = setup(
			table(),
			[[num("sun", 6), num("rain", 1)], [num("wind", 2)], [num("wind", 3)]],
			num("sun", 5),
		);
		expect(() => playCard(g, "a", { cardId: "rain-1-0" }, rng)).toThrow(RuleError);
		expect(() => playCard(g, "b", { cardId: "wind-2-0" }, rng)).toThrow(RuleError);
		g = playCard(g, "a", { cardId: "sun-6-0" }, rng);
		expect(g.turn).toBe(1);
		expect(g.suit).toBe("sun");
		expect(g.players[0]!.hand).toHaveLength(1);
	});

	test("Calm skips the next player; with two players you go again", () => {
		let g = setup(table(), [[act("sun", "calm"), num("sun", 1)]], num("sun", 5));
		g = playCard(g, "a", { cardId: "sun-calm-0" }, rng);
		expect(g.turn).toBe(2);
		expect(g.lastEvent).toMatchObject({ type: "played", skipped: "b" });
		let two = setup(table(2), [[act("sun", "calm"), num("sun", 1)]], num("sun", 5));
		two = playCard(two, "a", { cardId: "sun-calm-0" }, rng);
		expect(two.turn).toBe(0);
	});

	test("Swirl reverses the order", () => {
		let g = setup(table(), [[act("sun", "swirl"), num("sun", 1)]], num("sun", 5));
		g = playCard(g, "a", { cardId: "sun-swirl-0" }, rng);
		expect(g.direction).toBe(-1);
		expect(g.turn).toBe(2);
	});

	test("Gust hands a chosen card to the next player, and needs one", () => {
		let g = setup(
			table(),
			[[act("sun", "gust"), num("rain", 1), num("wind", 8)], [num("storm", 3)]],
			num("sun", 5),
		);
		expect(() => playCard(g, "a", { cardId: "sun-gust-0" }, rng)).toThrow(RuleError);
		g = playCard(g, "a", { cardId: "sun-gust-0", giveId: "wind-8-0" }, rng);
		expect(g.players[0]!.hand.map((c) => c.id)).toEqual(["rain-1-0"]);
		expect(g.players[1]!.hand.map((c) => c.id)).toEqual(["storm-3-0", "wind-8-0"]);
		expect(g.lastEvent).toMatchObject({ type: "played", gaveTo: "b" });
		// The view says who got a card, never which one.
		expect(JSON.stringify(publicView(g))).not.toContain("wind-8-0");
	});

	test("Rainbow needs a suit, and the next player must follow it", () => {
		let g = setup(table(), [[rainbow, num("sun", 1)]], num("sun", 5));
		expect(() => playCard(g, "a", { cardId: "rainbow-0" }, rng)).toThrow(RuleError);
		g = playCard(g, "a", { cardId: "rainbow-0", suit: "storm" }, rng);
		expect(g.suit).toBe("storm");
	});

	test("draw, then play only the drawn card or pass; the turn key stays during the draw", () => {
		let g = setup(table(), [[num("rain", 1)]], num("sun", 5));
		g = { ...g, deck: [num("sun", 2), ...g.deck] };
		const key = g.turnKey;
		g = drawCard(g, "a", rng);
		expect(g.turnKey).toBe(key);
		expect(handOf(g, "a").drawnId).toBe("sun-2-0");
		expect(() => drawCard(g, "a", rng)).toThrow(RuleError);
		expect(() => playCard(g, "a", { cardId: "rain-1-0" }, rng)).toThrow(RuleError);
		const played = playCard(g, "a", { cardId: "sun-2-0" }, rng);
		expect(played.turn).toBe(1);
		const passed = pass(g, "a");
		expect(passed.turn).toBe(1);
		expect(passed.turnKey).toBe(key + 1);
		expect(() => pass(passed, "b")).toThrow(RuleError);
	});

	test("an empty deck reshuffles everything under the top card", () => {
		let g = setup(table(), [[num("rain", 1)]], num("sun", 5));
		g = { ...g, deck: [], discard: [num("wind", 1), num("wind", 2), num("sun", 5)] };
		g = drawCard(g, "a", rng);
		expect(g.discard.map((c) => c.id)).toEqual(["sun-5-0"]);
		expect(g.players[0]!.hand).toHaveLength(2);
		expect(g.deck).toHaveLength(1);
	});
});

describe("rounds and points", () => {
	test("going out scores a point per card left for the others, then deals the next round", () => {
		let g = setup(
			table(),
			[[num("sun", 6)], [num("rain", 1), num("rain", 2)], [num("wind", 3)]],
			num("sun", 5),
		);
		g = playCard(g, "a", { cardId: "sun-6-0" }, rng);
		expect(g.players.map((p) => p.points)).toEqual([0, 2, 1]);
		expect(g.lastEvent).toMatchObject({
			type: "roundEnd",
			outId: "a",
			gained: { a: 0, b: 2, c: 1 },
			next: "round",
		});
		// The leftover hands are revealed with the event, not the freshly dealt ones.
		expect(g.lastEvent).toMatchObject({
			left: { a: [], b: [num("rain", 1), num("rain", 2)], c: [num("wind", 3)] },
		});
		expect(g.round).toBe(2);
		expect(g.turn).toBe(1); // the first turn moves one seat each round
		expect(g.players.every((p) => p.hand.length === HAND_SIZE)).toBe(true);
	});

	test("reaching the limit ends the match; fewest points wins, ties share a place", () => {
		let g = setup(table(), [[num("sun", 6)], [num("rain", 1)], [num("wind", 3)]], num("sun", 5));
		g = { ...g, players: g.players.map((p, i) => ({ ...p, points: [3, BURST_AT - 1, 3][i]! })) };
		g = playCard(g, "a", { cardId: "sun-6-0" }, rng);
		expect(g.phase).toBe("finished");
		expect(g.winnerId).toBe("a");
		expect([...placements(g).values()]).toEqual([1, 3, 2]);
		const report = buildReport(
			{ id: "m", startedAt: "2026-11-11T00:00:00.000Z", seq: 0 },
			g,
			"ABCD",
			"2026-11-11T00:10:00.000Z",
			[],
		);
		expect(report.players.map((p) => [p.placement, p.score])).toEqual([
			[1, 3],
			[3, BURST_AT],
			[2, 4],
		]);
	});

	test("a tie for fewest at the limit plays one more round", () => {
		let g = setup(table(), [[num("sun", 6)], [num("rain", 1)], [num("wind", 3)]], num("sun", 5));
		g = { ...g, players: g.players.map((p, i) => ({ ...p, points: [4, BURST_AT - 1, 3][i]! })) };
		g = playCard(g, "a", { cardId: "sun-6-0" }, rng);
		expect(g.phase).toBe("playing");
		expect(g.lastEvent).toMatchObject({ type: "roundEnd", tie: true });
	});

	test("reset keeps the table and clears points", () => {
		let g = setup(table(), [[num("sun", 6)], [num("rain", 1)], [num("wind", 3)]], num("sun", 5));
		g = { ...g, players: g.players.map((p) => ({ ...p, points: p.id === "a" ? 0 : BURST_AT })) };
		g = resetToLobby(playCard(g, "a", { cardId: "sun-6-0" }, rng), "a");
		expect(g.phase).toBe("lobby");
		expect(g.players.map((p) => p.points)).toEqual([0, 0, 0]);
	});
});

describe("bots", () => {
	test("slow down a player about to go out with a Calm", () => {
		const g = setup(
			table(),
			[[num("sun", 1), act("sun", "calm")], [num("rain", 1)]],
			num("sun", 5),
		);
		expect(chooseBotMove(g)).toEqual({ type: "play", input: { cardId: "sun-calm-0" } });
	});

	test("keep the Rainbow, draw when nothing fits, then play the drawn card or pass", () => {
		let g = setup(table(), [[rainbow, num("rain", 4)]], num("sun", 5));
		expect(chooseBotMove(g)).toEqual({ type: "play", input: { cardId: "rain-4-0" } });
		g = setup(table(), [[num("rain", 1)]], num("sun", 5));
		expect(chooseBotMove(g)).toEqual({ type: "draw" });
		expect(chooseBotMove(drawCard({ ...g, deck: [num("wind", 8)] }, "a", rng))).toEqual({
			type: "pass",
		});
	});

	test("Gust gives away a card of the suit held fewest of, never a Rainbow", () => {
		const g = setup(
			table(),
			[
				[act("sun", "gust"), rainbow, num("rain", 1), num("rain", 2), num("wind", 7)],
				[num("sun", 1), num("sun", 2), num("sun", 3)],
			],
			num("sun", 5),
		);
		expect(chooseBotMove(g)).toEqual({
			type: "play",
			input: { cardId: "sun-gust-0", giveId: "wind-7-0" },
		});
	});

	test("bots finish whole matches with valid results and a complete move log", () => {
		let seed = 7;
		const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		for (let run = 0; run < 50; run++) {
			let g = createGame();
			const n = 2 + (run % 5);
			for (let i = 0; i < n; i++) g = addPlayer(g, `p${i}`, `P${i}`, i > 0);
			const lobby = g;
			g = startGame(g, "p0", random);
			const log: LogEntry[] = logEvents(lobby, g);
			let steps = 0;
			while (g.phase === "playing" && steps++ < 5000) {
				const id = g.players[g.turn]!.id;
				const move = chooseBotMove(g);
				const next =
					move.type === "play"
						? playCard(g, id, move.input, random)
						: move.type === "draw"
							? drawCard(g, id, random)
							: pass(g, id);
				log.push(...logEvents(g, next, true));
				g = next;
			}
			expect(g.phase).toBe("finished");
			// Every move is logged once, rounds open with a deal, and the log ends with the final points.
			expect(log[0]!.type).toBe("deal");
			expect(log.filter((e) => e.type === "deal")).toHaveLength(g.round);
			expect(log.filter((e) => e.type === "round_end")).toHaveLength(g.round);
			expect(log.filter((e) => ["play", "draw", "pass"].includes(e.type))).toHaveLength(steps);
			expect(
				log.every(
					(e) => !("by" in (e.data ?? {})) || e.data!.by === (e.seat === 0 ? "timeout" : "bot"),
				),
			).toBe(true);
			expect(log.at(-1)).toEqual({
				type: "finished",
				data: {
					winner: g.players.find((p) => p.id === g.winnerId)!.seat,
					points: Object.fromEntries(g.players.map((p) => [p.seat, p.points])),
				},
			});
			expect([...placements(g).values()].filter((p) => p === 1)).toHaveLength(1);
			expect(Math.max(...g.players.map((p) => p.points))).toBeGreaterThanOrEqual(BURST_AT);
		}
	});
});
