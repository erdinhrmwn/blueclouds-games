import { LIMIT, type Card } from "./rules";

/**
 * Rule-based bot: play the biggest number that stays under the limit,
 * otherwise a safe special card, otherwise the smallest card (it will bust).
 */
export function chooseBotCard(hand: Card[], total: number): Card | undefined {
	const safe = hand.filter((c) => Math.max(0, total + c.value) <= LIMIT);
	const bestNumber = safe.filter((c) => c.kind === "number").sort((a, b) => b.value - a.value)[0];
	if (bestNumber) return bestNumber;
	// Save the -5 for emergencies: prefer zero/reverse when they are safe.
	const special = safe.find((c) => c.kind !== "minus") ?? safe[0];
	if (special) return special;
	return [...hand].sort((a, b) => a.value - b.value)[0];
}
