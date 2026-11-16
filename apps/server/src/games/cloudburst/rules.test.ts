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
import { randomRng, RuleError } from "../shared/table";

const rng = randomRng(() => 0.42);
const num = (suit: Card["suit"], value: number, copy = 0): Card => ({
	id: `${suit}-${value}-${copy}`,
	kind: "number",
	suit,
	value,
});
const act = (suit: Card["suit"], kind: "calm" | "swirl" | "gust" | "downpour", copy = 0): Card => ({
	id: `${suit}-${kind}-${copy}`,
	kind,
	suit,
	value: 0,
});
const rainbow: Card = { id: "rainbow-0", kind: "rainbow", suit: null, value: 0 };
const tempest: Card = { id: "tempest-0", kind: "tempest", suit: null, value: 0 };

function table(playerCount = 3): Game {
	let game = createGame();
	for (const id of ["a", "b", "c", "d"].slice(0, playerCount)) {
		game = addPlayer(game, id, id.toUpperCase());
	}

	return startGame(game, "a", rng);
}

/** Sets hands (by player index), the pile top and the suit, so a test controls the play. */
function setup(game: Game, hands: Card[][], top: Card, suit = top.suit!): Game {
	return {
		...game,
		players: game.players.map((player, i) => ({ ...player, hand: hands[i] ?? player.hand })),
		discard: [top],
		suit,
	};
}

describe("deck and fitting", () => {
	test("104 cards with unique ids", () => {
		const deck = buildDeck();
		expect(deck).toHaveLength(104);
		expect(new Set(deck.map((card) => card.id)).size).toBe(104);
		expect(deck.filter((card) => card.kind === "rainbow")).toHaveLength(4);
		expect(deck.filter((card) => card.kind === "tempest")).toHaveLength(4);
		expect(deck.filter((card) => card.kind === "downpour")).toHaveLength(8);
	});

	test("same suit, one step, same action or Rainbow fit; a same number alone does not", () => {
		const top = num("sun", 5);
		expect(fits(num("sun", 1), top, "sun")).toBe(true);
		expect(fits(num("rain", 4), top, "sun")).toBe(true);
		expect(fits(num("rain", 6), top, "sun")).toBe(true);
		expect(fits(num("rain", 5), top, "sun")).toBe(false);
		expect(fits(num("rain", 7), top, "sun")).toBe(false);
		expect(fits(rainbow, top, "sun")).toBe(true);
		expect(fits(tempest, top, "sun")).toBe(true);
		expect(fits(act("rain", "downpour"), act("sun", "downpour"), "sun")).toBe(true);
		expect(fits(act("rain", "downpour"), top, "sun")).toBe(false);
		expect(fits(act("rain", "calm"), act("sun", "calm"), "sun")).toBe(true);
		expect(fits(act("rain", "calm"), act("sun", "gust"), "sun")).toBe(false);
		// After a Rainbow only the chosen suit fits (no number to step from).
		expect(fits(num("wind", 2), rainbow, "rain")).toBe(false);
		expect(fits(num("rain", 2), rainbow, "rain")).toBe(true);
	});
});

describe("a round", () => {
	test("start deals 7 each, turns a non-Rainbow card up, first seat starts", () => {
		const game = table();
		expect(game.players.every((player) => player.hand.length === HAND_SIZE)).toBe(true);
		expect(game.discard).toHaveLength(1);
		expect(game.discard[0]!.kind).not.toBe("rainbow");
		expect(game.suit).toBe(game.discard[0]!.suit!);
		expect(game.turn).toBe(0);
		expect(game.round).toBe(1);
	});

	test("playing a fitting card moves the turn on; a wrong card or turn is refused", () => {
		let game = setup(
			table(),
			[[num("sun", 6), num("rain", 1)], [num("wind", 2)], [num("wind", 3)]],
			num("sun", 5),
		);
		expect(() => playCard(game, "a", { cardId: "rain-1-0" }, rng)).toThrow(RuleError);
		expect(() => playCard(game, "b", { cardId: "wind-2-0" }, rng)).toThrow(RuleError);
		game = playCard(game, "a", { cardId: "sun-6-0" }, rng);
		expect(game.turn).toBe(1);
		expect(game.suit).toBe("sun");
		expect(game.players[0]!.hand).toHaveLength(1);
	});

	test("Calm skips the next player; with two players you go again", () => {
		let game = setup(table(), [[act("sun", "calm"), num("sun", 1)]], num("sun", 5));
		game = playCard(game, "a", { cardId: "sun-calm-0" }, rng);
		expect(game.turn).toBe(2);
		expect(game.lastEvent).toMatchObject({ type: "played", skipped: "b" });
		let two = setup(table(2), [[act("sun", "calm"), num("sun", 1)]], num("sun", 5));
		two = playCard(two, "a", { cardId: "sun-calm-0" }, rng);
		expect(two.turn).toBe(0);
	});

	test("Swirl reverses the order", () => {
		let game = setup(table(), [[act("sun", "swirl"), num("sun", 1)]], num("sun", 5));
		game = playCard(game, "a", { cardId: "sun-swirl-0" }, rng);
		expect(game.direction).toBe(-1);
		expect(game.turn).toBe(2);
	});

	test("Gust hands a chosen card to the next player, and needs one", () => {
		let game = setup(
			table(),
			[[act("sun", "gust"), num("rain", 1), num("wind", 8)], [num("storm", 3)]],
			num("sun", 5),
		);
		expect(() => playCard(game, "a", { cardId: "sun-gust-0" }, rng)).toThrow(RuleError);
		game = playCard(game, "a", { cardId: "sun-gust-0", giveId: "wind-8-0" }, rng);
		expect(game.players[0]!.hand.map((card) => card.id)).toEqual(["rain-1-0"]);
		expect(game.players[1]!.hand.map((card) => card.id)).toEqual(["storm-3-0", "wind-8-0"]);
		expect(game.lastEvent).toMatchObject({ type: "played", gaveTo: "b" });
		// The view says who got a card, never which one.
		expect(JSON.stringify(publicView(game))).not.toContain("wind-8-0");
	});

	test("Rainbow needs a suit, and the next player must follow it", () => {
		let game = setup(table(), [[rainbow, num("sun", 1)]], num("sun", 5));
		expect(() => playCard(game, "a", { cardId: "rainbow-0" }, rng)).toThrow(RuleError);
		game = playCard(game, "a", { cardId: "rainbow-0", suit: "storm" }, rng);
		expect(game.suit).toBe("storm");
	});

	test("Downpour makes the next player draw 2 and lose their turn; no stacking", () => {
		let game = setup(
			table(),
			[[act("sun", "downpour"), num("sun", 1)], [act("rain", "downpour")]],
			num("sun", 5),
		);
		const drawn = game.deck.slice(0, 2).map((card) => card.id);
		game = playCard(game, "a", { cardId: "sun-downpour-0" }, rng);
		expect(game.players[1]!.hand.map((card) => card.id)).toEqual(["rain-downpour-0", ...drawn]);
		expect(game.turn).toBe(2);
		expect(game.lastEvent).toMatchObject({ type: "played", skipped: "b", forced: 2 });
		// The view says how many, never which cards.
		expect(JSON.stringify(publicView(game))).not.toContain(drawn[0]!);
	});

	test("Tempest needs a suit, then the next player draws 4 and loses their turn", () => {
		let game = setup(table(), [[tempest, num("sun", 1)], [num("rain", 2)]], num("sun", 5));
		expect(() => playCard(game, "a", { cardId: "tempest-0" }, rng)).toThrow(RuleError);
		game = playCard(game, "a", { cardId: "tempest-0", suit: "wind" }, rng);
		expect(game.suit).toBe("wind");
		expect(game.players[1]!.hand).toHaveLength(5);
		expect(game.turn).toBe(2);
		expect(game.lastEvent).toMatchObject({ skipped: "b", forced: 4 });
	});

	test("an empty deck refills from under the top card, on a draw and on a forced draw (logged)", () => {
		const base = setup(table(), [[act("sun", "downpour"), num("sun", 1)]], num("sun", 5));
		const game = {
			...base,
			deck: [num("wind", 3, 1)],
			discard: [num("rain", 4, 1), num("storm", 6, 1), num("sun", 5)],
		};
		const after = playCard(game, "a", { cardId: "sun-downpour-0" }, rng);
		expect(after.players[1]!.hand.slice(-2).map((card) => card.id)[0]).toBe("wind-3-1");
		expect(after.lastEvent).toMatchObject({ forced: 2 });
		expect(after.discard.map((card) => card.id)).toEqual(["sun-downpour-0"]);
		const entries = logEvents(game, after);
		expect(entries.map((entry) => entry.type)).toEqual(["reshuffle", "play"]);
		expect((entries[1]!.data as { forced: { cards: string[] } }).forced.cards).toHaveLength(2);

		let drawing = setup(table(), [[num("rain", 1)]], num("sun", 5));
		drawing = { ...drawing, deck: [], discard: [num("wind", 1), num("wind", 2), num("sun", 5)] };
		drawing = drawCard(drawing, "a", rng);
		expect(drawing.discard.map((card) => card.id)).toEqual(["sun-5-0"]);
		expect(drawing.players[0]!.hand).toHaveLength(2);
		expect(drawing.deck).toHaveLength(1);
	});

	test("draw, then play only the drawn card or pass; the turn key stays during the draw", () => {
		let game = setup(table(), [[num("rain", 1)]], num("sun", 5));
		game = { ...game, deck: [num("sun", 2), ...game.deck] };
		const key = game.turnKey;
		game = drawCard(game, "a", rng);
		expect(game.turnKey).toBe(key);
		expect(handOf(game, "a").drawnId).toBe("sun-2-0");
		expect(() => drawCard(game, "a", rng)).toThrow(RuleError);
		expect(() => playCard(game, "a", { cardId: "rain-1-0" }, rng)).toThrow(RuleError);
		const played = playCard(game, "a", { cardId: "sun-2-0" }, rng);
		expect(played.turn).toBe(1);
		const passed = pass(game, "a");
		expect(passed.turn).toBe(1);
		expect(passed.turnKey).toBe(key + 1);
		expect(() => pass(passed, "b")).toThrow(RuleError);
	});
});

describe("rounds and points", () => {
	test("going out scores a point per card left for the others, then deals the next round", () => {
		let game = setup(
			table(),
			[[num("sun", 6)], [num("rain", 1), num("rain", 2)], [num("wind", 3)]],
			num("sun", 5),
		);
		game = playCard(game, "a", { cardId: "sun-6-0" }, rng);
		expect(game.players.map((player) => player.points)).toEqual([0, 2, 1]);
		expect(game.lastEvent).toMatchObject({
			type: "roundEnd",
			outId: "a",
			gained: { a: 0, b: 2, c: 1 },
			next: "round",
		});
		// The leftover hands are revealed with the event, not the freshly dealt ones.
		expect(game.lastEvent).toMatchObject({
			left: { a: [], b: [num("rain", 1), num("rain", 2)], c: [num("wind", 3)] },
		});
		expect(game.round).toBe(2);
		expect(game.turn).toBe(1); // the first turn moves one seat each round
		expect(game.players.every((player) => player.hand.length === HAND_SIZE)).toBe(true);
	});

	test("reaching the limit ends the match; fewest points wins, ties share a place", () => {
		let game = setup(table(), [[num("sun", 6)], [num("rain", 1)], [num("wind", 3)]], num("sun", 5));
		game = {
			...game,
			players: game.players.map((player, i) => ({ ...player, points: [3, BURST_AT - 1, 3][i]! })),
		};
		game = playCard(game, "a", { cardId: "sun-6-0" }, rng);
		expect(game.phase).toBe("finished");
		expect(game.winnerId).toBe("a");
		expect([...placements(game).values()]).toEqual([1, 3, 2]);
		const report = buildReport(
			{ id: "m", startedAt: "2026-11-11T00:00:00.000Z", seq: 0 },
			game,
			"ABCD",
			"2026-11-11T00:10:00.000Z",
			[],
		);
		expect(report.players.map((player) => [player.placement, player.score])).toEqual([
			[1, 3],
			[3, BURST_AT],
			[2, 4],
		]);
	});

	test("a tie for fewest at the limit plays one more round", () => {
		let game = setup(table(), [[num("sun", 6)], [num("rain", 1)], [num("wind", 3)]], num("sun", 5));
		game = {
			...game,
			players: game.players.map((player, i) => ({ ...player, points: [4, BURST_AT - 1, 3][i]! })),
		};
		game = playCard(game, "a", { cardId: "sun-6-0" }, rng);
		expect(game.phase).toBe("playing");
		expect(game.lastEvent).toMatchObject({ type: "roundEnd", tie: true });
	});

	test("reset keeps the table and clears points", () => {
		let game = setup(table(), [[num("sun", 6)], [num("rain", 1)], [num("wind", 3)]], num("sun", 5));
		game = {
			...game,
			players: game.players.map((player) => ({
				...player,
				points: player.id === "a" ? 0 : BURST_AT,
			})),
		};
		game = resetToLobby(playCard(game, "a", { cardId: "sun-6-0" }, rng), "a");
		expect(game.phase).toBe("lobby");
		expect(game.players.map((player) => player.points)).toEqual([0, 0, 0]);
	});
});

describe("bots", () => {
	test("slow down a player about to go out with a Calm", () => {
		const game = setup(
			table(),
			[[num("sun", 1), act("sun", "calm")], [num("rain", 1)]],
			num("sun", 5),
		);
		expect(chooseBotMove(game)).toEqual({ type: "play", input: { cardId: "sun-calm-0" } });
	});

	test("keep the Rainbow, draw when nothing fits, then play the drawn card or pass", () => {
		let game = setup(table(), [[rainbow, num("rain", 4)]], num("sun", 5));
		expect(chooseBotMove(game)).toEqual({ type: "play", input: { cardId: "rain-4-0" } });
		game = setup(table(), [[num("rain", 1)]], num("sun", 5));
		expect(chooseBotMove(game)).toEqual({ type: "draw" });
		expect(chooseBotMove(drawCard({ ...game, deck: [num("wind", 8)] }, "a", rng))).toEqual({
			type: "pass",
		});
	});

	test("Gust gives away a card of the suit held fewest of, never a Rainbow", () => {
		const game = setup(
			table(),
			[
				[act("sun", "gust"), rainbow, num("rain", 1), num("rain", 2), num("wind", 7)],
				[num("sun", 1), num("sun", 2), num("sun", 3)],
			],
			num("sun", 5),
		);
		expect(chooseBotMove(game)).toEqual({
			type: "play",
			input: { cardId: "sun-gust-0", giveId: "wind-7-0" },
		});
	});

	test("bots finish whole matches with valid results and a complete move log", () => {
		let seed = 7;
		const random = randomRng(() => {
			seed = (seed * 16807) % 2147483647;

			return (seed - 1) / 2147483646;
		});
		for (let run = 0; run < 50; run++) {
			let game = createGame();
			const playerCount = 2 + (run % 5);
			for (let i = 0; i < playerCount; i++) {
				game = addPlayer(game, `p${i}`, `P${i}`, i > 0);
			}

			const lobby = game;
			game = startGame(game, "p0", random);
			const log: LogEntry[] = logEvents(lobby, game);
			let steps = 0;
			while (game.phase === "playing" && steps < 5000) {
				steps += 1;
				const id = game.players[game.turn]!.id;
				const move = chooseBotMove(game);
				let next: Game;
				if (move.type === "play") {
					next = playCard(game, id, move.input, random);
				} else if (move.type === "draw") {
					next = drawCard(game, id, random);
				} else {
					next = pass(game, id);
				}

				log.push(...logEvents(game, next, true));
				game = next;
			}

			expect(game.phase).toBe("finished");
			// Every move is logged once, rounds open with a deal, and the log ends with the final points.
			expect(log[0]!.type).toBe("deal");
			expect(log.filter((event) => event.type === "deal")).toHaveLength(game.round);
			expect(log.filter((event) => event.type === "round_end")).toHaveLength(game.round);
			expect(log.filter((event) => ["play", "draw", "pass"].includes(event.type))).toHaveLength(
				steps,
			);
			expect(
				log.every(
					(event) =>
						!("by" in (event.data ?? {})) ||
						event.data!.by === (event.seat === 0 ? "timeout" : "bot"),
				),
			).toBe(true);
			expect(log.at(-1)).toEqual({
				type: "finished",
				data: {
					winner: game.players.find((player) => player.id === game.winnerId)!.seat,
					points: Object.fromEntries(game.players.map((player) => [player.seat, player.points])),
				},
			});
			expect([...placements(game).values()].filter((place) => place === 1)).toHaveLength(1);
			expect(Math.max(...game.players.map((player) => player.points))).toBeGreaterThanOrEqual(
				BURST_AT,
			);
		}
	});
});
