// "Bust 31": pure game rules, no Rivet. Every function returns a new state
// or throws RuleError, so the actor can forward the message to the player.

export const LIMIT = 31;
export const HAND_SIZE = 3;
export const START_LIVES = 3;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** How long a human has to play before a card is played for them. */
export const TURN_MS = 20_000;
/** Dealing animation timing, shared so the server holds the first turn of a round until it ends. */
export const DEAL = { stepMs: 80, flightMs: 400, afterBustMs: 1300 };
const MINUS_VALUE = 5;

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
};

export type GameEvent =
	| { type: "joined"; playerId: string }
	| { type: "started" }
	| { type: "played"; playerId: string; card: Card; total: number; auto?: boolean }
	| { type: "bust"; playerId: string; card: Card; total: number; eliminated: boolean; auto?: boolean }
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

/** Returns a float in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;

export class RuleError extends Error {}

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
	for (let copy = 0; copy < 4; copy++) {
		for (let v = 1; v <= 9; v++) cards.push({ id: `n${v}-${copy}`, kind: "number", value: v });
		cards.push({ id: `z-${copy}`, kind: "zero", value: 0 });
		cards.push({ id: `m-${copy}`, kind: "minus", value: -MINUS_VALUE });
		cards.push({ id: `r-${copy}`, kind: "reverse", value: 0 });
	}
	return cards;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

/** Sits a new player in `seat`, or in the first free one when no seat is given. */
export function addPlayer(game: Game, id: string, name: string, bot = false, seat?: number): Game {
	if (game.players.some((p) => p.id === id)) return game;
	if (game.phase !== "lobby") throw new RuleError("The game has already started.");
	const chosen = seat ?? freeSeats(game)[0];
	if (chosen === undefined) throw new RuleError("This table is full.");
	assertFreeSeat(game, chosen);
	return {
		...game,
		// A bot can never be host: someone has to press start.
		hostId: game.hostId ?? (bot ? null : id),
		players: bySeat([...game.players, { id, name, lives: START_LIVES, hand: [], bot, seat: chosen }]),
		lastEvent: { type: "joined", playerId: id },
	};
}

/** Moves a player to an empty chair. Lobby only, so the turn order never changes mid-game. */
export function takeSeat(game: Game, id: string, seat: number): Game {
	if (game.phase !== "lobby") throw new RuleError("Seats are locked while a game is running.");
	if (!game.players.some((p) => p.id === id)) throw new RuleError("Join the table first.");
	assertFreeSeat(game, seat);
	return { ...game, players: bySeat(game.players.map((p) => (p.id === id ? { ...p, seat } : p))) };
}

export function freeSeats(game: Game): number[] {
	const taken = new Set(game.players.map((p) => p.seat));
	return Array.from({ length: MAX_PLAYERS }, (_, s) => s).filter((s) => !taken.has(s));
}

function assertFreeSeat(game: Game, seat: number) {
	if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_PLAYERS) throw new RuleError("That seat does not exist.");
	if (game.players.some((p) => p.seat === seat)) throw new RuleError("That seat is taken.");
}

// Players are kept in seat order, so `turn` and `nextAlive` walk around the table.
const bySeat = (players: Player[]) => [...players].sort((a, b) => a.seat - b.seat);

/** Only allowed in the lobby; mid-game seats stay so the turn order holds. */
export function removePlayer(game: Game, id: string): Game {
	if (game.phase !== "lobby") return game;
	const players = game.players.filter((p) => p.id !== id);
	const hostId = game.hostId === id ? (players.find((p) => !p.bot)?.id ?? null) : game.hostId;
	return { ...game, players, hostId };
}

export function startGame(game: Game, byId: string, rng: Rng): Game {
	if (game.hostId !== byId) throw new RuleError("Only the host can start the game.");
	if (game.phase === "playing") throw new RuleError("The game is already running.");
	if (game.players.length < MIN_PLAYERS) throw new RuleError(`Needs at least ${MIN_PLAYERS} players.`);
	const players = game.players.map((p) => ({ ...p, lives: START_LIVES, hand: [] }));
	const dealt = dealRound({ ...game, players, round: 0, winnerId: null }, 0, rng);
	return { ...dealt, phase: "playing", lastEvent: { type: "started" }, moves: game.moves + 1 };
}

export function playCard(game: Game, playerId: string, cardId: string, rng: Rng): Game {
	if (game.phase !== "playing") throw new RuleError("The game has not started yet.");
	const current = game.players[game.turn];
	if (current?.id !== playerId) throw new RuleError("It is not your turn yet.");
	const card = current.hand.find((c) => c.id === cardId);
	if (!card) throw new RuleError("That card is not in your hand.");

	const total = Math.max(0, game.total + card.value);
	const hand = current.hand.filter((c) => c.id !== cardId);

	if (total > LIMIT) {
		const lives = current.lives - 1;
		const players = game.players.map((p) => (p.id === playerId ? { ...p, lives, hand } : p));
		const alive = players.filter((p) => p.lives > 0);
		const bust: GameEvent = { type: "bust", playerId, card, total, eliminated: lives === 0 };
		if (alive.length === 1) {
			return {
				...game,
				players,
				total,
				phase: "finished",
				winnerId: alive[0]!.id,
				lastEvent: { type: "finished", winnerId: alive[0]!.id },
				moves: game.moves + 1,
			};
		}
		// Loser starts the next round; if they are out, the next alive seat does.
		const starter = lives > 0 ? game.turn : nextAlive(players, game.turn, game.direction);
		return { ...dealRound({ ...game, players }, starter, rng), lastEvent: bust, moves: game.moves + 1 };
	}

	let { deck, discard } = game;
	discard = [...discard, card];
	if (deck.length === 0) {
		// The card just played stays on the pile; everything under it becomes the new deck.
		deck = shuffle(discard.slice(0, -1), rng);
		discard = [card];
	}
	const [drawn, ...rest] = deck;
	const players = game.players.map((p) => (p.id === playerId ? { ...p, hand: drawn ? [...hand, drawn] : hand } : p));
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

export function setAway(game: Game, id: string, away: boolean): Game {
	return { ...game, players: game.players.map((p) => (p.id === id && !p.bot ? { ...p, away } : p)) };
}

/** Host sends everyone back to the lobby after a finished game. */
export function resetToLobby(game: Game, byId: string): Game {
	if (game.hostId !== byId) throw new RuleError("Only the host can start over.");
	if (game.phase !== "finished") throw new RuleError("The game is not over yet.");
	return {
		...createGame(),
		moves: game.moves,
		hostId: game.hostId,
		// Players who walked away mid-game don't come back to the lobby.
		players: game.players.filter((p) => !p.away).map((p) => ({ ...p, lives: START_LIVES, hand: [] })),
	};
}

function dealRound(game: Game, starter: number, rng: Rng): Game {
	let deck = shuffle(buildDeck(), rng);
	const players = game.players.map((p) => {
		if (p.lives <= 0) return { ...p, hand: [] };
		const hand = deck.slice(0, HAND_SIZE);
		deck = deck.slice(HAND_SIZE);
		return { ...p, hand };
	});
	return { ...game, players, deck, discard: [], total: 0, direction: 1, turn: starter, round: game.round + 1 };
}

function nextAlive(players: Player[], from: number, direction: 1 | -1): number {
	const n = players.length;
	for (let step = 1; step <= n; step++) {
		const i = (((from + step * direction) % n) + n) % n;
		if (players[i]!.lives > 0) return i;
	}
	return from;
}

/**
 * What every player may see: no hands, no deck order.
 * `turn` is relative (ms left, full length) so clients with a wrong clock still count down correctly.
 */
export function publicView(game: Game, turn: { left: number; total: number } | null = null) {
	return {
		phase: game.phase,
		hostId: game.hostId,
		players: game.players.map((p) => ({ id: p.id, name: p.name, lives: p.lives, bot: p.bot, seat: p.seat, away: !!p.away })),
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
	const e = game.lastEvent;
	if (game.phase !== "playing" || (e?.type !== "started" && e?.type !== "bust")) return 0;
	const alive = game.players.filter((p) => p.lives > 0).length;
	return (e.type === "bust" ? DEAL.afterBustMs : 0) + alive * HAND_SIZE * DEAL.stepMs + DEAL.flightMs + 100;
}

export function handOf(game: Game, playerId: string): Card[] {
	return game.players.find((p) => p.id === playerId)?.hand ?? [];
}
