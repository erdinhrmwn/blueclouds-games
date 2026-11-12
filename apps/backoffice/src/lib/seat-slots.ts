/** Someone at a table, as the Live tables cards show them. Open tables have no player ids. */
export type SlotPlayer = { name: string; playerId: string | null; bot: boolean };

/**
 * Lays players out over a table's seats: each one in their own seat, and anyone without a seat yet (a tournament
 * player not seated by the room) in the first empty one. Empty seats stay null, so every seat shows.
 */
export function seatSlots(
	seatCount: number,
	players: (SlotPlayer & { seat: number | null })[]
): (SlotPlayer | null)[] {
	const size = Math.max(seatCount, players.length);
	const slots: (SlotPlayer | null)[] = Array.from({ length: size }, () => null);
	const unseated: SlotPlayer[] = [];

	for (const { seat, ...player } of players) {
		const fits = seat !== null && seat >= 0 && seat < size && slots[seat] === null;
		if (fits) {
			slots[seat] = player;
		} else {
			unseated.push(player);
		}
	}

	for (const player of unseated) {
		const free = slots.indexOf(null);
		slots[free] = player;
	}

	return slots;
}
