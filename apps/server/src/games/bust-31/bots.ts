import { LIMIT, totalAfter, type Card } from "./rules";

/**
 * Rule-based bot: play the biggest number that stays under the limit,
 * otherwise a safe special card, otherwise the card that busts by the least.
 */
export function chooseBotCard(hand: Card[], total: number): Card | undefined {
	const safe = hand.filter((card) => totalAfter(total, card) <= LIMIT);

	const [bestNumber] = safe
		.filter((card) => card.kind === "number")
		.sort((a, b) => b.value - a.value);
	if (bestNumber) return bestNumber;

	// Save the -5 and the Ten for emergencies: prefer the other special cards when they are safe.
	const kept = new Set<Card["kind"]>(["minus", "ten"]);
	const special = safe.find((card) => !kept.has(card.kind)) ?? safe[0];
	if (special) return special;

	return [...hand].sort((a, b) => totalAfter(total, a) - totalAfter(total, b))[0];
}
