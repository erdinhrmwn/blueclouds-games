import { nextIndex } from "../shared/table";
import { type Card, fits, type Game, type PlayInput, type Suit, SUITS } from "./rules";

export type BotMove = { type: "play"; input: PlayInput } | { type: "draw" } | { type: "pass" };

/** Slow the leader down when the next player is about to go out. */
const STOPPERS = ["calm", "gust", "swirl"] as const;

/**
 * Rule-based bot (also plays for timed-out and away humans):
 * 1. next player has 1–2 cards: Calm, then Gust, then Swirl, if one fits;
 * 2. otherwise a fitting non-Rainbow card, from the suit it holds most of;
 * 3. Rainbow only when nothing else fits; nothing fits: draw, then play the card if it fits, or pass.
 */
export function chooseBotMove(game: Game): BotMove {
	const me = game.players[game.turn]!;
	const top = game.discard.at(-1)!;
	const canPlay = me.hand.filter((c) => fits(c, top, game.suit) && (!game.drew || c.id === game.drawnId));
	if (canPlay.length === 0) return game.drew ? { type: "pass" } : { type: "draw" };

	const next = game.players[nextIndex(game.players, game.turn, game.direction)]!;
	const count = suitCounts(me.hand);
	const pick = next.hand.length <= 2 ? STOPPERS.map((k) => canPlay.find((c) => c.kind === k)).find(Boolean) : undefined;
	const card =
		pick ??
		canPlay.filter((c) => c.kind !== "rainbow").sort((a, b) => count.get(b.suit!)! - count.get(a.suit!)!)[0] ??
		canPlay[0]!;

	const rest = me.hand.filter((c) => c.id !== card.id);
	const input: PlayInput = { cardId: card.id };
	if (card.kind === "rainbow") input.suit = mostHeld(rest) ?? game.suit;
	if (card.kind === "gust" && rest.length > 0) input.giveId = leastUseful(rest).id;
	return { type: "play", input };
}

function suitCounts(hand: Card[]): Map<Suit, number> {
	const count = new Map(SUITS.map((s) => [s, 0]));
	for (const c of hand) if (c.suit) count.set(c.suit, count.get(c.suit)! + 1);
	return count;
}

function mostHeld(hand: Card[]): Suit | undefined {
	const count = suitCounts(hand);
	const best = Math.max(...count.values());
	return best > 0 ? SUITS.find((s) => count.get(s) === best) : undefined;
}

/** Never a Rainbow (unless that is all it has); otherwise a card of the suit it holds fewest of. */
function leastUseful(hand: Card[]): Card {
	const count = suitCounts(hand);
	const plain = hand.filter((c) => c.kind !== "rainbow");
	return plain.sort((a, b) => count.get(a.suit!)! - count.get(b.suit!)!)[0] ?? hand[0]!;
}
