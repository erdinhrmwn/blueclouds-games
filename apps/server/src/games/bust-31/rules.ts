// "Bust 31": pure game rules, no Rivet. Every function returns a new state
// or throws RuleError, so the actor can forward the message to the player.
import { nextIndex, type Rng, RuleError, SEATS, seatPlayer, shuffle } from "../shared/table";

export const LIMIT = 31;
export const HAND_SIZE = 3;
export const START_LIVES = 3;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = SEATS;
/** How long a human has to play before a card is played for them. */
export const TURN_MS = 20_000;
/** Dealing animation timing, shared so the server holds the first turn of a round until it ends. */
export const DEAL = { stepMs: 80, flightMs: 400, afterBustMs: 1300 };
const MINUS_VALUE = 5;
const COPIES_PER_CARD = 4;
const HIGHEST_NUMBER = 9;
/** Extra wait after the deal animation, so the first turn never starts mid-flight. */
const DEAL_SETTLE_MS = 100;

export type CardKind = "number" | "zero" | "minus" | "reverse";
export type Card = { id: string; kind: CardKind; value: number };

export type Player = {
	id: string;
	name: string;
	lives: number;
	hand: Card[];
	bot: boolean;
	/** Fixed chair at the table, 0 to MAX_PLAYERS - 1. Turns go up the seat numbers (clockwise). */
	seat: number;
	/** A human who closed the game mid-match: their turns are played for them until they return. */
	away?: boolean;
	vip?: boolean;
};

export type GameEvent =
	| { type: "joined"; playerId: string }
	| { type: "started" }
	| { type: "played"; playerId: string; card: Card; total: number; auto?: boolean }
	| {
			type: "bust";
			playerId: string;
			card: Card;
			total: number;
			eliminated: boolean;
			auto?: boolean;
	  }
	| { type: "finished"; winnerId: string };

export type Game = {
	phase: "lobby" | "playing" | "finished";
	hostId: string | null;
	players: Player[];
	deck: Card[];
	discard: Card[];
	total: number;
	turn: number; // index into players
	direction: 1 | -1;
	round: number;
	winnerId: string | null;
	lastEvent: GameEvent | null;
	/** Counts every deal and play, never resets: identifies a game position for timers. */
	moves: number;
};

export function createGame(): Game {
	return {
		phase: "lobby",
		hostId: null,
		players: [],
		deck: [],
		discard: [],
		total: 0,
		turn: 0,
		direction: 1,
		round: 0,
		winnerId: null,
		lastEvent: null,
		moves: 0,
	};
}

/** 48 cards: 1–9 four times each, plus four of each special card. */
export function buildDeck(): Card[] {
	const cards: Card[] = [];
	for (let copy = 0; copy < COPIES_PER_CARD; copy++) {
		for (let value = 1; value <= HIGHEST_NUMBER; value++) {
			cards.push({ id: `n${value}-${copy}`, kind: "number", value });
		}
		cards.push({ id: `z-${copy}`, kind: "zero", value: 0 });
		cards.push({ id: `m-${copy}`, kind: "minus", value: -MINUS_VALUE });
		cards.push({ id: `r-${copy}`, kind: "reverse", value: 0 });
	}

	return cards;
}

/** Sits a new player in `seat`, or in the first free one when no seat is given. */
export function addPlayer(game: Game, id: string, name: string, bot = false, seat?: number): Game {
	if (game.players.some((p) => p.id === id)) return game;

	const player = { id, name, lives: START_LIVES, hand: [], bot };
	const seated = seatPlayer<Game, Player>(game, player, seat);

	return { ...seated, lastEvent: { type: "joined", playerId: id } };
}

export function startGame(game: Game, byId: string, rng: Rng): Game {
	if (game.hostId !== byId) throw new RuleError("Only the host can start the game.");
	if (game.phase === "playing") throw new RuleError("The game is already running.");
	if (game.players.length < MIN_PLAYERS) {
		throw new RuleError(`Needs at least ${MIN_PLAYERS} players.`);
	}

	const players = game.players.map((p) => ({ ...p, lives: START_LIVES, hand: [] }));
	const dealt = dealRound({ ...game, players, round: 0, winnerId: null }, 0, rng);

	return { ...dealt, phase: "playing", lastEvent: { type: "started" }, moves: game.moves + 1 };
}

export function playCard(game: Game, playerId: string, cardId: string, rng: Rng): Game {
	if (game.phase !== "playing") throw new RuleError("The game has not started yet.");

	const current = game.players[game.turn];
	if (current?.id !== playerId) throw new RuleError("It is not your turn yet.");

	const card = current.hand.find((held) => held.id === cardId);
	if (!card) throw new RuleError("That card is not in your hand.");

	const total = Math.max(0, game.total + card.value);
	const hand = current.hand.filter((held) => held.id !== cardId);

	if (total > LIMIT) {
		return bust(game, current, card, total, hand, rng);
	}

	let { deck, discard } = game;
	discard = [...discard, card];
	if (deck.length === 0) {
		// The card just played stays on the pile; everything under it becomes the new deck.
		deck = shuffle(discard.slice(0, -1), rng);
		discard = [card];
	}

	const [drawn, ...rest] = deck;
	const newHand = drawn ? [...hand, drawn] : hand;
	const players = game.players.map((p) => (p.id === playerId ? { ...p, hand: newHand } : p));
	const direction = card.kind === "reverse" ? (-game.direction as 1 | -1) : game.direction;

	return {
		...game,
		players,
		deck: rest,
		discard,
		total,
		direction,
		turn: nextAlive(players, game.turn, direction),
		lastEvent: { type: "played", playerId, card, total },
		moves: game.moves + 1,
	};
}

/** The total went over LIMIT: the player loses a life, then a new round, or the end of the match. */
function bust(
	game: Game,
	current: Player,
	card: Card,
	total: number,
	hand: Card[],
	rng: Rng,
): Game {
	const lives = current.lives - 1;
	const players = game.players.map((p) => (p.id === current.id ? { ...p, lives, hand } : p));
	const alive = players.filter((p) => p.lives > 0);

	if (alive.length === 1) {
		const winnerId = alive[0]!.id;
		return {
			...game,
			players,
			total,
			phase: "finished",
			winnerId,
			lastEvent: { type: "finished", winnerId },
			moves: game.moves + 1,
		};
	}

	// Loser starts the next round; if they are out, the next alive seat does.
	const starter = lives > 0 ? game.turn : nextAlive(players, game.turn, game.direction);
	const event: GameEvent = {
		type: "bust",
		playerId: current.id,
		card,
		total,
		eliminated: lives === 0,
	};

	return {
		...dealRound({ ...game, players }, starter, rng),
		lastEvent: event,
		moves: game.moves + 1,
	};
}

/** Host sends everyone back to the lobby after a finished game. */
export function resetToLobby(game: Game, byId: string): Game {
	if (game.hostId !== byId) throw new RuleError("Only the host can start over.");
	if (game.phase !== "finished") throw new RuleError("The game is not over yet.");

	// Players who walked away mid-game don't come back to the lobby.
	const players = game.players
		.filter((player) => !player.away)
		.map((player) => ({ ...player, lives: START_LIVES, hand: [] }));

	return {
		...createGame(),
		moves: game.moves,
		hostId: game.hostId,
		players,
	};
}

function dealRound(game: Game, starter: number, rng: Rng): Game {
	let deck = shuffle(buildDeck(), rng);
	const players = game.players.map((player) => {
		if (player.lives <= 0) return { ...player, hand: [] };

		const hand = deck.slice(0, HAND_SIZE);
		deck = deck.slice(HAND_SIZE);
		return { ...player, hand };
	});

	return {
		...game,
		players,
		deck,
		discard: [],
		total: 0,
		direction: 1,
		turn: starter,
		round: game.round + 1,
	};
}

const nextAlive = (players: Player[], from: number, direction: 1 | -1) =>
	nextIndex(players, from, direction, (p) => p.lives > 0);

/**
 * What every player may see: no hands, no deck order.
 * `turn` is relative (ms left, full length) so clients with a wrong clock still count down correctly.
 */
export function publicView(game: Game, turn: { left: number; total: number } | null = null) {
	return {
		phase: game.phase,
		hostId: game.hostId,
		players: game.players.map((p) => ({
			id: p.id,
			name: p.name,
			lives: p.lives,
			bot: p.bot,
			seat: p.seat,
			away: !!p.away,
			vip: !!p.vip,
		})),
		deckCount: game.deck.length,
		topCard: game.discard.at(-1) ?? null,
		/** Up to three cards played before the top one, oldest first. */
		pileUnder: game.discard.slice(-4, -1),
		total: game.total,
		limit: LIMIT,
		turnPlayerId: game.phase === "playing" ? (game.players[game.turn]?.id ?? null) : null,
		direction: game.direction,
		round: game.round,
		winnerId: game.winnerId,
		lastEvent: game.lastEvent,
		moves: game.moves,
		turn,
	};
}

export type PublicView = ReturnType<typeof publicView>;

/**
 * How long the first turn of a fresh round waits for the dealing animation
 * (plus the bust stamp before it). 0 for any other turn.
 */
export function dealPauseMs(game: Game): number {
	const event = game.lastEvent;
	if (game.phase !== "playing") return 0;
	if (event?.type !== "started" && event?.type !== "bust") return 0;

	const alive = game.players.filter((player) => player.lives > 0).length;
	const bustStampMs = event.type === "bust" ? DEAL.afterBustMs : 0;
	const dealMs = alive * HAND_SIZE * DEAL.stepMs + DEAL.flightMs;

	return bustStampMs + dealMs + DEAL_SETTLE_MS;
}

export function handOf(game: Game, playerId: string): Card[] {
	return game.players.find((p) => p.id === playerId)?.hand ?? [];
}
