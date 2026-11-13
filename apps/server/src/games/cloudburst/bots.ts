import { nextIndex } from "../shared/table";
import { type Card, fits, type Game, isWild, type PlayInput, type Suit, SUITS } from "./rules";

export type BotMove = { type: "play"; input: PlayInput } | { type: "draw" } | { type: "pass" };

/** Slow the leader down when the next player is about to go out. */
const STOPPERS = ["calm", "downpour", "gust", "swirl"] as const;

/** The next player counts as "about to go out" at this many cards or fewer. */
const NEARLY_OUT = 2;

/**
 * Rule-based bot (also plays for timed-out and away humans):
 * 1. next player has 1–2 cards: Calm, then Downpour, then Gust, then Swirl, if one fits;
 * 2. otherwise a fitting non-wild card, from the suit it holds most of;
 * 3. a wild card (Rainbow, Tempest) only when nothing else fits; nothing fits: draw, then play the card if it
 *    fits, or pass.
 */
export function chooseBotMove(game: Game): BotMove {
	const me = game.players[game.turn]!;
	const top = game.discard.at(-1)!;

	// After a draw only the drawn card may be played.
	const canPlay = me.hand.filter((card) => {
		if (game.drew && card.id !== game.drawnId) return false;
		return fits(card, top, game.suit);
	});

	if (canPlay.length === 0) {
		return game.drew ? { type: "pass" } : { type: "draw" };
	}

	const card = pickCard(game, me.hand, canPlay);
	const rest = me.hand.filter((held) => held.id !== card.id);
	const input: PlayInput = { cardId: card.id };

	if (isWild(card)) {
		input.suit = mostHeld(rest) ?? game.suit;
	}
	if (card.kind === "gust" && rest.length > 0) {
		input.giveId = leastUseful(rest).id;
	}

	return { type: "play", input };
}

/** Rules 1–3 above: a stopper when needed, else a card of the most-held suit, else a wild card. */
function pickCard(game: Game, hand: Card[], canPlay: Card[]): Card {
	const next = game.players[nextIndex(game.players, game.turn, game.direction)]!;
	if (next.hand.length <= NEARLY_OUT) {
		for (const kind of STOPPERS) {
			const stopper = canPlay.find((card) => card.kind === kind);
			if (stopper) return stopper;
		}
	}

	const count = suitCounts(hand);
	const [bestPlain] = canPlay
		.filter((card) => !isWild(card))
		.sort((a, b) => count.get(b.suit!)! - count.get(a.suit!)!);

	return bestPlain ?? canPlay[0]!;
}

function suitCounts(hand: Card[]): Map<Suit, number> {
	const count = new Map(SUITS.map((suit) => [suit, 0]));
	for (const card of hand) {
		if (card.suit) count.set(card.suit, count.get(card.suit)! + 1);
	}

	return count;
}

function mostHeld(hand: Card[]): Suit | undefined {
	const count = suitCounts(hand);
	const best = Math.max(...count.values());
	if (best === 0) return undefined;

	return SUITS.find((suit) => count.get(suit) === best);
}

/** Never a wild card (unless that is all it has); otherwise a card of the suit it holds fewest of. */
function leastUseful(hand: Card[]): Card {
	const count = suitCounts(hand);
	const plain = hand.filter((card) => !isWild(card));
	const [fewestHeld] = plain.sort((a, b) => count.get(a.suit!)! - count.get(b.suit!)!);

	return fewestHeld ?? hand[0]!;
}
