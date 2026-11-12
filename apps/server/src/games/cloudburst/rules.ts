// "Cloudburst": pure game rules, no Rivet. Every function returns a new state
// or throws RuleError, so the actor can forward the message to the player.
// Rules and their reasons: docs/games/cloudburst/rules.md.
import { nextIndex, type Rng, RuleError, SEATS, seatPlayer, shuffle } from "../shared/table";

export const HAND_SIZE = 7;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = SEATS;
/** The match ends after the round in which anyone reaches this many points. */
export const BURST_AT = 10;
/** How long a human has to move before the server moves for them. */
export const TURN_MS = 20_000;
/** Dealing and round-end timing, shared so the server holds the first turn of a round until they end. */
export const DEAL = { stepMs: 60, flightMs: 400, roundEndMs: 4000 };

export const SUITS = ["sun", "rain", "wind", "storm"] as const;
export type Suit = (typeof SUITS)[number];
export const ACTIONS = ["calm", "swirl", "gust"] as const;
export type CardKind = "number" | (typeof ACTIONS)[number] | "rainbow";
/** `value` is 1–8 for numbers and 0 otherwise; `suit` is null only for a Rainbow. */
export type Card = { id: string; kind: CardKind; suit: Suit | null; value: number };

export type Player = {
	id: string;
	name: string;
	bot: boolean;
	/** Fixed chair at the table, 0 to SEATS - 1. Turns go up the seat numbers (clockwise). */
	seat: number;
	away?: boolean;
	hand: Card[];
	/** Points so far this match: one per card left when someone else went out. Fewest wins. */
	points: number;
};

/**
 * What happened last, for the table's animations. Never holds a card other players must not see:
 * the hands in `roundEnd.left` are shown on purpose, the round is over and they go back in the deck.
 */
export type GameEvent =
	| { type: "joined"; playerId: string }
	| { type: "dealt"; round: number }
	| {
			type: "played";
			playerId: string;
			card: Card;
			skipped?: string;
			gaveTo?: string;
			auto?: boolean;
	  }
	| { type: "drew"; playerId: string; got: boolean; auto?: boolean }
	| { type: "passed"; playerId: string; auto?: boolean }
	| {
			type: "roundEnd";
			outId: string;
			card: Card;
			gained: Record<string, number>;
			/** The cards each player still held, face up for the round-end reveal. */
			left: Record<string, Card[]>;
			tie: boolean;
			next: "round" | "finished";
	  };

export type Game = {
	phase: "lobby" | "playing" | "finished";
	hostId: string | null;
	players: Player[];
	deck: Card[];
	discard: Card[];
	/** The suit to follow: the top card's, or the one its player chose for a Rainbow. */
	suit: Suit;
	turn: number; // index into players
	direction: 1 | -1;
	round: number;
	/** The current player drew this turn: they may play only that card (`drawnId`), or pass. */
	drew: boolean;
	drawnId: string | null;
	winnerId: string | null;
	lastEvent: GameEvent | null;
	/** Counts every change; clients use it to spot a new event. */
	moves: number;
	/** Changes whenever a new turn starts (not on a draw): keys the turn timer. */
	turnKey: number;
};

export type PlayInput = { cardId: string; suit?: Suit; giveId?: string };

export function createGame(): Game {
	return {
		phase: "lobby",
		hostId: null,
		players: [],
		deck: [],
		discard: [],
		suit: "sun",
		turn: 0,
		direction: 1,
		round: 0,
		drew: false,
		drawnId: null,
		winnerId: null,
		lastEvent: null,
		moves: 0,
		turnKey: 0,
	};
}

/** 92 cards: per suit, numbers 1–8 and Calm, Swirl, Gust, two of each; plus four Rainbows. */
export function buildDeck(): Card[] {
	const cards: Card[] = [];
	for (const suit of SUITS) {
		for (let copy = 0; copy < 2; copy++) {
			for (let v = 1; v <= 8; v++)
				cards.push({ id: `${suit}-${v}-${copy}`, kind: "number", suit, value: v });
			for (const kind of ACTIONS)
				cards.push({ id: `${suit}-${kind}-${copy}`, kind, suit, value: 0 });
		}
	}
	for (let i = 0; i < 4; i++)
		cards.push({ id: `rainbow-${i}`, kind: "rainbow", suit: null, value: 0 });
	return cards;
}

/** Same suit, a number exactly one up or down, the same action, or any Rainbow. A same number alone does not fit. */
export function fits(card: Card, top: Card, suit: Suit): boolean {
	if (card.kind === "rainbow" || card.suit === suit) return true;
	if (card.kind === "number")
		return top.kind === "number" && Math.abs(card.value - top.value) === 1;
	return card.kind === top.kind;
}

/** Sits a new player in `seat`, or in the first free one when no seat is given. */
export function addPlayer(game: Game, id: string, name: string, bot = false, seat?: number): Game {
	if (game.players.some((p) => p.id === id)) return game;
	const seated = seatPlayer<Game, Player>(game, { id, name, bot, hand: [], points: 0 }, seat);
	return { ...seated, lastEvent: { type: "joined", playerId: id } };
}

export function startGame(game: Game, byId: string, rng: Rng): Game {
	if (game.hostId !== byId) throw new RuleError("Only the host can start the game.");
	if (game.phase === "playing") throw new RuleError("The game is already running.");
	if (game.players.length < MIN_PLAYERS)
		throw new RuleError(`Needs at least ${MIN_PLAYERS} players.`);
	const players = game.players.map((p) => ({ ...p, points: 0, hand: [] }));
	return {
		...dealRound({ ...game, players, round: 0, winnerId: null }, rng),
		phase: "playing",
		moves: game.moves + 1,
	};
}

function currentPlayer(game: Game, playerId: string): Player {
	if (game.phase !== "playing") throw new RuleError("The game has not started yet.");
	const current = game.players[game.turn];
	if (current?.id !== playerId) throw new RuleError("It is not your turn yet.");
	return current;
}

export function playCard(game: Game, playerId: string, input: PlayInput, rng: Rng): Game {
	const current = currentPlayer(game, playerId);
	const card = current.hand.find((c) => c.id === input.cardId);
	if (!card) throw new RuleError("That card is not in your hand.");
	if (game.drew && card.id !== game.drawnId)
		throw new RuleError("After drawing you can only play the card you drew, or pass.");
	const top = game.discard.at(-1)!;
	if (!fits(card, top, game.suit)) throw new RuleError("That card does not fit the pile.");
	if (card.kind === "rainbow" && !input.suit) throw new RuleError("Pick a suit for the Rainbow.");
	if (input.suit && !SUITS.includes(input.suit)) throw new RuleError("That suit does not exist.");

	let hand = current.hand.filter((c) => c.id !== card.id);
	const nextUp = nextIndex(game.players, game.turn, game.direction);
	let give: Card | undefined;
	if (card.kind === "gust" && hand.length > 0) {
		give = hand.find((c) => c.id === input.giveId);
		if (!give) throw new RuleError("Pick a card to give with the Gust.");
		hand = hand.filter((c) => c.id !== give!.id);
	}
	const players = game.players.map((p, i) =>
		i === game.turn ? { ...p, hand } : i === nextUp && give ? { ...p, hand: [...p.hand, give] } : p,
	);
	const played = {
		...game,
		players,
		discard: [...game.discard, card],
		suit: card.suit ?? input.suit!,
		drew: false,
		drawnId: null,
	};

	if (hand.length === 0) return endRound(played, playerId, card, rng);

	const direction = card.kind === "swirl" ? (-game.direction as 1 | -1) : game.direction;
	let turn = nextIndex(players, game.turn, direction);
	let skipped: string | undefined;
	if (card.kind === "calm") {
		skipped = players[turn]!.id;
		turn = nextIndex(players, turn, direction);
	}
	return {
		...played,
		direction,
		turn,
		lastEvent: {
			type: "played",
			playerId,
			card,
			...(skipped ? { skipped } : {}),
			...(give ? { gaveTo: players[nextUp]!.id } : {}),
		},
		moves: game.moves + 1,
		turnKey: game.turnKey + 1,
	};
}

/** Draws one card. Afterwards the player may play that card (if it fits) or pass. */
export function drawCard(game: Game, playerId: string, rng: Rng): Game {
	const current = currentPlayer(game, playerId);
	if (game.drew) throw new RuleError("You already drew this turn. Play the card or pass.");
	let { deck, discard } = game;
	if (deck.length === 0 && discard.length > 1) {
		// Everything under the top card becomes the new deck.
		deck = shuffle(discard.slice(0, -1), rng);
		discard = discard.slice(-1);
	}
	const [drawn, ...rest] = deck;
	const players = game.players.map((p) =>
		p.id === current.id && drawn ? { ...p, hand: [...p.hand, drawn] } : p,
	);
	return {
		...game,
		players,
		deck: drawn ? rest : deck,
		discard,
		drew: true,
		drawnId: drawn?.id ?? null,
		lastEvent: { type: "drew", playerId, got: !!drawn },
		moves: game.moves + 1,
	};
}

/** Ends your turn without playing. Only after drawing. */
export function pass(game: Game, playerId: string): Game {
	currentPlayer(game, playerId);
	if (!game.drew) throw new RuleError("Draw a card first, or play one.");
	return {
		...game,
		drew: false,
		drawnId: null,
		turn: nextIndex(game.players, game.turn, game.direction),
		lastEvent: { type: "passed", playerId },
		moves: game.moves + 1,
		turnKey: game.turnKey + 1,
	};
}

/** Someone went out: everyone else takes a point per card left. Then a new round, or the end of the match. */
function endRound(game: Game, outId: string, card: Card, rng: Rng): Game {
	const gained: Record<string, number> = {};
	const left: Record<string, Card[]> = {};
	const players = game.players.map((p) => {
		gained[p.id] = p.hand.length;
		left[p.id] = p.hand;
		return { ...p, points: p.points + p.hand.length };
	});
	const fewest = Math.min(...players.map((p) => p.points));
	const leaders = players.filter((p) => p.points === fewest);
	const burst = players.some((p) => p.points >= BURST_AT);
	const finished = burst && leaders.length === 1;
	const roundEnd: GameEvent = {
		type: "roundEnd",
		outId,
		card,
		gained,
		left,
		tie: burst && !finished,
		next: finished ? "finished" : "round",
	};
	const scored = {
		...game,
		players,
		lastEvent: roundEnd,
		moves: game.moves + 1,
		turnKey: game.turnKey + 1,
	};
	if (finished) return { ...scored, phase: "finished", winnerId: leaders[0]!.id };
	return { ...dealRound(scored, rng), lastEvent: roundEnd };
}

/** A fresh deal from the full deck. The first turn moves one seat clockwise each round. */
function dealRound(game: Game, rng: Rng): Game {
	let deck = shuffle(buildDeck(), rng);
	const players = game.players.map((p) => {
		const hand = deck.slice(0, HAND_SIZE);
		deck = deck.slice(HAND_SIZE);
		return { ...p, hand };
	});
	// A Rainbow can't start the pile (nobody chose its suit): it goes back under the deck.
	const startAt = deck.findIndex((c) => c.kind !== "rainbow");
	const start = deck[startAt]!;
	deck = [...deck.slice(0, startAt), ...deck.slice(startAt + 1)];
	const round = game.round + 1;
	return {
		...game,
		players,
		deck,
		discard: [start],
		suit: start.suit!,
		direction: 1,
		turn: (round - 1) % players.length,
		round,
		drew: false,
		drawnId: null,
		lastEvent: { type: "dealt", round },
		turnKey: game.turnKey + 1,
	};
}

/** Host sends everyone back to the lobby after a finished game. */
export function resetToLobby(game: Game, byId: string): Game {
	if (game.hostId !== byId) throw new RuleError("Only the host can start over.");
	if (game.phase !== "finished") throw new RuleError("The game is not over yet.");
	return {
		...createGame(),
		moves: game.moves + 1,
		turnKey: game.turnKey + 1,
		hostId: game.hostId,
		// Players who walked away mid-game don't come back to the lobby.
		players: game.players.filter((p) => !p.away).map((p) => ({ ...p, points: 0, hand: [] })),
	};
}

/** Places by points, fewest first; equal points share a place (1st is never shared). */
export function placements(game: Game): Map<string, number> {
	return new Map(
		game.players.map((p) => [p.id, 1 + game.players.filter((o) => o.points < p.points).length]),
	);
}

/**
 * What every player may see: hand sizes, never the cards in them, nor the deck order.
 * `turn` is relative (ms left, full length) so clients with a wrong clock still count down correctly.
 */
export function publicView(game: Game, turn: { left: number; total: number } | null = null) {
	return {
		phase: game.phase,
		hostId: game.hostId,
		players: game.players.map((p) => ({
			id: p.id,
			name: p.name,
			bot: p.bot,
			seat: p.seat,
			away: !!p.away,
			cards: p.hand.length,
			points: p.points,
		})),
		deckCount: game.deck.length,
		topCard: game.discard.at(-1) ?? null,
		/** Up to three cards played before the top one, oldest first. */
		pileUnder: game.discard.slice(-4, -1),
		suit: game.suit,
		direction: game.direction,
		turnPlayerId: game.phase === "playing" ? (game.players[game.turn]?.id ?? null) : null,
		drew: game.drew,
		round: game.round,
		burstAt: BURST_AT,
		winnerId: game.winnerId,
		lastEvent: game.lastEvent,
		moves: game.moves,
		turn,
	};
}

export type PublicView = ReturnType<typeof publicView>;

/** Your own hand, plus the card you just drew (the only one you may play now). */
export function handOf(game: Game, playerId: string): { cards: Card[]; drawnId: string | null } {
	const mine = game.phase === "playing" && game.players[game.turn]?.id === playerId;
	return {
		cards: game.players.find((p) => p.id === playerId)?.hand ?? [],
		drawnId: mine ? game.drawnId : null,
	};
}

/**
 * How long the first turn of a fresh round waits for the round-end summary and the deal. 0 otherwise.
 */
export function dealPauseMs(game: Game): number {
	const e = game.lastEvent;
	if (game.phase !== "playing" || (e?.type !== "dealt" && e?.type !== "roundEnd")) return 0;
	return (
		(e.type === "roundEnd" ? DEAL.roundEndMs : 0) +
		game.players.length * HAND_SIZE * DEAL.stepMs +
		DEAL.flightMs +
		100
	);
}
