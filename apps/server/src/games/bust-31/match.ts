import type { Game } from "./rules";

/** Bump when a rule change makes old results incomparable to new ones. */
export const RULES_VERSION = 1;

/** The game in progress, as far as the platform needs it. `out` lists player ids in the order they were eliminated. */
export type MatchState = { id: string; startedAt: string; out: string[] };

export type MatchReport = {
	matchId: string;
	game: "bust-31";
	roomCode: string;
	rulesVersion: number;
	startedAt: string;
	endedAt: string;
	players: { seat: number; playerId: string | null; bot: boolean; botName?: string; placement: number; score: number }[];
};

/**
 * A UUIDv7 (time-ordered), as the platform wants for match ids. Not Bun.randomUUIDv7():
 * the web app type-checks this file too, without Bun's types.
 */
export function uuidv7(now = Date.now()): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff; // 48-bit ms timestamp
	b[6] = (b[6]! & 0x0f) | 0x70; // version 7
	b[8] = (b[8]! & 0x3f) | 0x80; // RFC 9562 variant
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Notes who lost their last life on the move that produced `game`. Call after every move. */
export function noteMove(match: MatchState, game: Game): MatchState {
	const out = game.players.filter((p) => p.lives <= 0 && !match.out.includes(p.id)).map((p) => p.id);
	return out.length ? { ...match, out: [...match.out, ...out] } : match;
}

/** The result of a finished game: the winner places 1st, the last one out 2nd, and so on. */
export function buildReport(match: MatchState, game: Game, roomCode: string, endedAt: string): MatchReport {
	if (game.phase !== "finished" || !game.winnerId) throw new Error("buildReport needs a finished game");
	const { out } = noteMove(match, game);
	const placement = (id: string) => (id === game.winnerId ? 1 : out.length - out.indexOf(id) + 1);
	return {
		matchId: match.id,
		game: "bust-31",
		roomCode,
		rulesVersion: RULES_VERSION,
		startedAt: match.startedAt,
		endedAt,
		players: game.players.map((p) => ({
			seat: p.seat,
			playerId: p.bot ? null : p.id,
			bot: p.bot,
			...(p.bot ? { botName: p.name } : {}),
			placement: placement(p.id),
			score: Math.max(0, p.lives),
		})),
	};
}
