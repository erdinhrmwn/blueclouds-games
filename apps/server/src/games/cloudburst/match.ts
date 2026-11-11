import type { MatchReport } from "../shared/match";
import { type Game, placements } from "./rules";

/** Bump when a rule change makes old results incomparable to new ones. */
export const RULES_VERSION = 1;

/** The match in progress, as far as the platform needs it. */
export type MatchState = { id: string; startedAt: string };

/** The result of a finished match: placed by points (fewest first), and each seat's points as its score. */
export function buildReport(match: MatchState, game: Game, roomCode: string, endedAt: string): MatchReport {
	if (game.phase !== "finished" || !game.winnerId) throw new Error("buildReport needs a finished game");
	const place = placements(game);
	return {
		matchId: match.id,
		game: "cloudburst",
		roomCode,
		rulesVersion: RULES_VERSION,
		startedAt: match.startedAt,
		endedAt,
		players: game.players.map((p) => ({
			seat: p.seat,
			playerId: p.bot ? null : p.id,
			bot: p.bot,
			...(p.bot ? { botName: p.name } : {}),
			placement: place.get(p.id)!,
			score: p.points,
		})),
	};
}
