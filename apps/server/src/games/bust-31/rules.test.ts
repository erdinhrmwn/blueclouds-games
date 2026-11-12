import { describe, expect, test } from "bun:test";
import { chooseBotCard } from "./bots";
import {
	addPlayer,
	buildDeck,
	createGame,
	DEAL,
	dealPauseMs,
	type Card,
	type Game,
	LIMIT,
	playCard,
	resetToLobby,
	START_LIVES,
	startGame,
} from "./rules";
import { markAway, markBack, removePlayer, RuleError, takeSeat } from "../shared/table";

const rng = () => 0.42;
const card = (kind: Card["kind"], value: number, id = `${kind}${value}`): Card => ({
	id,
	kind,
	value,
});

function twoPlayerGame(): Game {
	let g = createGame();
	g = addPlayer(g, "a", "Ann");
	g = addPlayer(g, "b", "Bob");
	return startGame(g, "a", rng);
}

/** Puts a fixed hand on the current player so tests control the play. */
function withHand(g: Game, hand: Card[], total = g.total): Game {
	return { ...g, total, players: g.players.map((p, i) => (i === g.turn ? { ...p, hand } : p)) };
}

describe("lobby", () => {
	test("first player becomes host, joining twice is a no-op", () => {
		let g = addPlayer(createGame(), "a", "Ann");
		g = addPlayer(g, "a", "Ann");
		expect(g.hostId).toBe("a");
		expect(g.players).toHaveLength(1);
	});

	test("start needs host and two players", () => {
		const one = addPlayer(createGame(), "a", "Ann");
		expect(() => startGame(one, "a", rng)).toThrow(RuleError);
		const two = addPlayer(one, "b", "Bob");
		expect(() => startGame(two, "b", rng)).toThrow("host");
	});

	test("no joining once the game started", () => {
		expect(() => addPlayer(twoPlayerGame(), "c", "Cleo")).toThrow(RuleError);
	});
});

describe("seats", () => {
	test("players fill the first free seat, a bot can take a chosen one", () => {
		let g = addPlayer(createGame(), "a", "Ann");
		g = addPlayer(g, "bot", "Bot", true, 4);
		g = addPlayer(g, "b", "Bob");
		expect(g.players.map((p) => [p.id, p.seat])).toEqual([
			["a", 0],
			["b", 1],
			["bot", 4],
		]);
		expect(() => addPlayer(g, "c", "Cleo", false, 4)).toThrow("taken");
		expect(() => addPlayer(g, "c", "Cleo", false, 6)).toThrow("does not exist");
	});

	test("moving seats keeps players in seat order, so turns follow the table", () => {
		let g = addPlayer(addPlayer(addPlayer(createGame(), "a", "Ann"), "b", "Bob"), "c", "Cleo");
		g = takeSeat(g, "a", 5);
		expect(g.players.map((p) => p.id)).toEqual(["b", "c", "a"]);
		const started = startGame(g, "a", rng);
		expect(started.players[started.turn]!.id).toBe("b");
		expect(() => takeSeat(started, "b", 3)).toThrow("locked");
	});

	test("a full table has no free seat", () => {
		let g = createGame();
		for (const id of ["a", "b", "c", "d", "e", "f"]) g = addPlayer(g, id, id);
		expect(() => addPlayer(g, "g", "g")).toThrow("full");
	});
});

describe("deal", () => {
	test("deck has 48 unique cards and each player gets 3", () => {
		const deck = buildDeck();
		expect(new Set(deck.map((c) => c.id)).size).toBe(48);
		const g = twoPlayerGame();
		expect(g.players.every((p) => p.hand.length === 3)).toBe(true);
		expect(g.deck).toHaveLength(48 - 6);
	});
});

describe("playing", () => {
	test("rejects playing out of turn or a card not in hand", () => {
		const g = twoPlayerGame();
		const other = g.players[1 - g.turn]!;
		expect(() => playCard(g, other.id, other.hand[0]!.id, rng)).toThrow("not your turn");
		expect(() => playCard(g, g.players[g.turn]!.id, "nope", rng)).toThrow("not in your hand");
	});

	test("adds value, draws a card and passes the turn", () => {
		const g = withHand(twoPlayerGame(), [card("number", 7)], 10);
		const me = g.players[g.turn]!.id;
		const next = playCard(g, me, "number7", rng);
		expect(next.total).toBe(17);
		expect(next.players.find((p) => p.id === me)!.hand).toHaveLength(1);
		expect(next.players[next.turn]!.id).not.toBe(me);
	});

	test("minus card never drops the total below zero", () => {
		const g = withHand(twoPlayerGame(), [card("minus", -5)], 3);
		expect(playCard(g, g.players[g.turn]!.id, "minus-5", rng).total).toBe(0);
	});

	test("reverse flips direction", () => {
		const g = withHand(twoPlayerGame(), [card("reverse", 0)]);
		expect(playCard(g, g.players[g.turn]!.id, "reverse0", rng).direction).toBe(-1);
	});

	test("reshuffles the discard pile when the deck runs out", () => {
		const base = withHand(twoPlayerGame(), [card("number", 1)], 0);
		const g = { ...base, deck: [], discard: [card("number", 2, "x"), card("number", 3, "y")] };
		const next = playCard(g, g.players[g.turn]!.id, "number1", rng);
		expect(next.deck).toHaveLength(1); // 2 cards shuffled back, 1 drawn
		expect(next.discard.map((c) => c.id)).toEqual(["number1"]); // the played card stays on the pile
	});

	test(`going over ${LIMIT} costs a life and starts a new round`, () => {
		const g = withHand(twoPlayerGame(), [card("number", 9)], 30);
		const me = g.players[g.turn]!.id;
		const next = playCard(g, me, "number9", rng);
		expect(next.players.find((p) => p.id === me)!.lives).toBe(START_LIVES - 1);
		expect(next.total).toBe(0);
		expect(next.round).toBe(2);
		expect(next.players[next.turn]!.id).toBe(me);
		expect(next.lastEvent?.type).toBe("bust");
	});

	test("last player standing wins, host can reset to lobby", () => {
		let g = withHand(twoPlayerGame(), [card("number", 9)], 30);
		g = { ...g, players: g.players.map((p, i) => (i === g.turn ? { ...p, lives: 1 } : p)) };
		const loser = g.players[g.turn]!.id;
		const done = playCard(g, loser, "number9", rng);
		expect(done.phase).toBe("finished");
		expect(done.winnerId).not.toBe(loser);

		const lobby = resetToLobby(done, "a");
		expect(lobby.phase).toBe("lobby");
		expect(lobby.players.every((p) => p.lives === START_LIVES)).toBe(true);
	});
});

describe("away players", () => {
	test("a player who left mid-game keeps the seat, then is not taken back to the lobby", () => {
		const g = markAway(twoPlayerGame(), "b");
		expect(g.players.find((p) => p.id === "b")?.away).toBe(true);
		const done = { ...g, phase: "finished" as const };
		expect(resetToLobby(done, "a").players.map((p) => p.id)).toEqual(["a"]);
		expect(markBack(g, "b").players.find((p) => p.id === "b")?.away).toBe(false);
	});
});

describe("deal pause", () => {
	test("holds the first turn of a round for the dealing animation, longer after a bust", () => {
		const g = twoPlayerGame();
		const dealing = 2 * 3 * DEAL.stepMs + DEAL.flightMs + 100;
		expect(dealPauseMs(g)).toBe(dealing);
		const played = playCard(
			withHand(g, [card("number", 1)], 0),
			g.players[g.turn]!.id,
			"number1",
			rng,
		);
		expect(dealPauseMs(played)).toBe(0);
		const bust = playCard(
			withHand(g, [card("number", 9)], 30),
			g.players[g.turn]!.id,
			"number9",
			rng,
		);
		expect(dealPauseMs(bust)).toBe(DEAL.afterBustMs + dealing);
	});
});

describe("move counter", () => {
	test("counts every deal and play, and survives going back to the lobby", () => {
		const g = withHand(twoPlayerGame(), [card("number", 9)], 30);
		expect(g.moves).toBe(1);
		const afterBust = playCard(
			{ ...g, players: g.players.map((p, i) => (i === g.turn ? { ...p, lives: 1 } : p)) },
			g.players[g.turn]!.id,
			"number9",
			rng,
		);
		expect(afterBust.moves).toBe(2);
		expect(resetToLobby(afterBust, "a").moves).toBe(2);
	});
});

describe("bot", () => {
	test("a bot never becomes host, and host passes to a human", () => {
		let g = addPlayer(createGame(), "bot1", "Bot", true);
		g = addPlayer(g, "a", "Ann");
		g = addPlayer(g, "b", "Bob");
		expect(g.hostId).toBe("a");
		expect(removePlayer(g, "a").hostId).toBe("b");
	});

	test("plays the biggest safe number", () => {
		const hand = [card("number", 3), card("number", 8), card("minus", -5)];
		expect(chooseBotCard(hand, 20)?.id).toBe("number8");
	});

	test("falls back to a safe special card, then to the smallest card", () => {
		expect(chooseBotCard([card("number", 9), card("minus", -5)], 30)?.kind).toBe("minus");
		expect(chooseBotCard([card("number", 9), card("number", 4)], 30)?.id).toBe("number4");
	});
});
