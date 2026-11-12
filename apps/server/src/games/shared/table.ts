// Pure table rules every game shares: seats, host, shuffling. No Rivet here.

/** Every game has a table of 6 fixed chairs around the dealer. */
export const SEATS = 6;

/** Returns a float in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;

/** A rule was broken; the actor forwards the message to the player. */
export class RuleError extends Error {}

/** What the shared helpers need from a player. Turns go up the seat numbers (clockwise). */
export type Seated = { id: string; name: string; bot: boolean; seat: number; away?: boolean };

/** What the shared helpers need from a game. */
export type Table<P extends Seated = Seated> = {
	phase: "lobby" | "playing" | "finished";
	hostId: string | null;
	players: P[];
	moves: number;
};

export function shuffle<T>(items: T[], rng: Rng): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}

	return out;
}

// Players are kept in seat order, so a turn index walks around the table.
export const bySeat = <P extends Seated>(players: P[]) =>
	[...players].sort((a, b) => a.seat - b.seat);

export function freeSeats(players: Seated[]): number[] {
	const taken = new Set(players.map((p) => p.seat));
	const allSeats = Array.from({ length: SEATS }, (_, seat) => seat);

	return allSeats.filter((seat) => !taken.has(seat));
}

function assertFreeSeat(players: Seated[], seat: number) {
	if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) {
		throw new RuleError("That seat does not exist.");
	}
	if (players.some((p) => p.seat === seat)) throw new RuleError("That seat is taken.");
}

/**
 * Sits `player` in `seat`, or in the first free one when no seat is given. Lobby only.
 * The first human becomes host (a bot can't be: someone has to press start).
 */
export function seatPlayer<G extends Table<P>, P extends Seated>(
	game: G,
	player: Omit<P, "seat">,
	seat?: number,
): G {
	if (game.phase !== "lobby") throw new RuleError("The game has already started.");
	const chosen = seat ?? freeSeats(game.players)[0];
	if (chosen === undefined) throw new RuleError("This table is full.");
	assertFreeSeat(game.players, chosen);

	const seated = { ...player, seat: chosen } as P;
	const hostId = game.hostId ?? (player.bot ? null : player.id);

	return { ...game, hostId, players: bySeat([...game.players, seated]) };
}

/** Moves a player to an empty chair. Lobby only, so the turn order never changes mid-game. */
export function takeSeat<G extends Table>(game: G, id: string, seat: number): G {
	if (game.phase !== "lobby") throw new RuleError("Seats are locked while a game is running.");
	if (!game.players.some((p) => p.id === id)) throw new RuleError("Join the table first.");
	assertFreeSeat(game.players, seat);

	const moved = game.players.map((p) => (p.id === id ? { ...p, seat } : p));
	return { ...game, players: bySeat(moved) };
}

/** Only allowed in the lobby; mid-game seats stay so the turn order holds. */
export function removePlayer<G extends Table>(game: G, id: string): G {
	if (game.phase !== "lobby") return game;

	const players = game.players.filter((p) => p.id !== id);

	// The host leaving hands the table to the next human.
	let hostId = game.hostId;
	if (hostId === id) {
		hostId = players.find((p) => !p.bot)?.id ?? null;
	}

	return { ...game, players, hostId };
}

/** A human who closed the game mid-match: their turns are played for them until they return. */
export function setAway<G extends Table>(game: G, id: string, away: boolean): G {
	return {
		...game,
		players: game.players.map((p) => (p.id === id && !p.bot ? { ...p, away } : p)),
	};
}

/** The next index around the table in `direction` whose player `inPlay` accepts (or `from` if none does). */
export function nextIndex<P>(
	players: P[],
	from: number,
	direction: 1 | -1,
	inPlay: (p: P) => boolean = () => true,
): number {
	const count = players.length;
	for (let step = 1; step <= count; step++) {
		// Wraps around both ways: ((x % n) + n) % n is never negative.
		const index = (((from + step * direction) % count) + count) % count;
		if (inPlay(players[index]!)) return index;
	}

	return from;
}
