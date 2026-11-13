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
	publicView,
	resetToLobby,
	START_LIVES,
	startGame,
	TEN_TOTAL,
} from "./rules";
import {
	markAway,
	markBack,
	markVip,
	randomRng,
	removePlayer,
	RuleError,
	takeSeat,
} from "../shared/table";

const rng = randomRng(() => 0.42);
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

function threePlayerGame(): Game {
	let g = createGame();
	g = addPlayer(g, "a", "Ann");
	g = addPlayer(g, "b", "Bob");
	g = addPlayer(g, "c", "Cleo");
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
	test("deck has 54 unique cards and each player gets 3", () => {
		const deck = buildDeck();
		expect(new Set(deck.map((c) => c.id)).size).toBe(54);

		const rare = deck.filter((c) => c.kind === "swap" || c.kind === "ten" || c.kind === "double");
		expect(rare).toHaveLength(6);

		const g = twoPlayerGame();
		expect(g.players.every((p) => p.hand.length === 3)).toBe(true);
		expect(g.deck).toHaveLength(54 - 6);
		expect(g.playsLeft).toBe(1);
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

	test("a Ten sets the total to 10, up or down", () => {
		const high = withHand(twoPlayerGame(), [card("ten", 0)], 28);
		expect(playCard(high, high.players[high.turn]!.id, "ten0", rng).total).toBe(TEN_TOTAL);

		const low = withHand(twoPlayerGame(), [card("ten", 0)], 3);
		expect(playCard(low, low.players[low.turn]!.id, "ten0", rng).total).toBe(TEN_TOTAL);
	});

	test("a Swap trades hands with the next player and passes the turn to them", () => {
		let g = threePlayerGame();
		const swap = card("swap", 0);
		const theirs = [card("number", 1, "x1"), card("number", 2, "x2"), card("number", 3, "x3")];
		g = withHand(g, [swap, card("number", 9, "k1"), card("number", 8, "k2")], 12);
		const me = g.players[g.turn]!.id;
		const nextSeat = (g.turn + 1) % g.players.length;
		g = { ...g, players: g.players.map((p, i) => (i === nextSeat ? { ...p, hand: theirs } : p)) };
		const drawnCard = g.deck[0]!;

		const after = playCard(g, me, swap.id, rng);
		const mine = after.players.find((p) => p.id === me)!.hand.map((c) => c.id);
		const next = after.players[nextSeat]!;

		expect(mine).toEqual(["x1", "x2", "x3"]);
		expect(next.hand.map((c) => c.id)).toEqual(["k1", "k2", drawnCard.id]);
		expect(after.turn).toBe(nextSeat);
		expect(after.total).toBe(12);
		expect(after.lastEvent).toMatchObject({ type: "played", swappedWith: next.id });
	});

	test("after a Double the next player plays two cards in a row, then the turn moves on", () => {
		let g = withHand(threePlayerGame(), [card("double", 0)], 5);
		const first = g.turn;
		g = playCard(g, g.players[first]!.id, "double0", rng);

		const second = g.turn;
		expect(second).not.toBe(first);
		expect(g.playsLeft).toBe(2);
		expect(publicView(g).playsLeft).toBe(2);

		g = withHand(g, [card("number", 1, "a1"), card("number", 2, "a2")]);
		g = playCard(g, g.players[second]!.id, "a1", rng);
		expect(g.turn).toBe(second);
		expect(g.playsLeft).toBe(1);

		g = playCard(g, g.players[second]!.id, "a2", rng);
		expect(g.turn).not.toBe(second);
		expect(g.playsLeft).toBe(1);
		expect(g.total).toBe(8);
	});

	test("a Double played while owing two plays passes both plays on and ends your own", () => {
		let g = withHand(threePlayerGame(), [card("double", 0, "d1")], 5);
		g = playCard(g, g.players[g.turn]!.id, "d1", rng);
		const owing = g.turn;

		g = withHand(g, [card("double", 0, "d2")]);
		g = playCard(g, g.players[owing]!.id, "d2", rng);
		expect(g.turn).not.toBe(owing);
		expect(g.playsLeft).toBe(2);
	});

	test("busting while owing two plays deals a new round with one play", () => {
		let g = withHand(threePlayerGame(), [card("double", 0)], 25);
		g = playCard(g, g.players[g.turn]!.id, "double0", rng);
		const owing = g.players[g.turn]!.id;

		g = withHand(g, [card("number", 9)]);
		g = playCard(g, owing, "number9", rng);
		expect(g.lastEvent?.type).toBe("bust");
		expect(g.playsLeft).toBe(1);
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

describe("VIP players", () => {
	test("only the marked player shows as a VIP", () => {
		const g = markVip(twoPlayerGame(), "b");
		const shown = publicView(g).players.map((p) => [p.id, p.vip]);

		expect(shown).toEqual([
			["a", false],
			["b", true],
		]);
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

	test("keeps the Ten and the -5 for emergencies, and plays the Ten when nothing else is safe", () => {
		const hand = [card("ten", 0), card("minus", -5), card("swap", 0)];
		expect(chooseBotCard(hand, 30)?.kind).toBe("swap");
		expect(chooseBotCard([card("number", 9), card("ten", 0)], 30)?.kind).toBe("ten");
	});
});
