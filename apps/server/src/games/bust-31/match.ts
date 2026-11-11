import type { Game } from "./rules";
import type { MatchReport } from "../shared/match";

/** Bump when a rule change makes old results incomparable to new ones. */
export const RULES_VERSION = 1;

/** The game in progress, as far as the platform needs it. `out` lists player ids in the order they were eliminated. */
export type MatchState = { id: string; startedAt: string; out: string[] };

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
