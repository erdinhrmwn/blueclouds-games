// What every game sends the platform when a match ends: placements, a game-defined score
// per seat, and the full move log (docs/architecture/match-log.md).
import type { MatchSeeds } from "./fairness";

/** One step of the move log, before it gets its place (`seq`) and time (`t`, ms since the start). */
export type LogEntry = { type: string; seat?: number; data?: Record<string, unknown> };
export type LogEvent = LogEntry & { seq: number; t: number };

/**
 * The match in progress: its id, when it started, and how many log events it has so far. `seeds` drive its
 * shuffles (fairness.ts); matches started before provably fair shuffles have none.
 */
export type MatchState = { id: string; startedAt: string; seq: number; seeds?: MatchSeeds };

/** Who made a logged move: the player, a bot, or the server for an away or timed-out human. */
export type MoveBy = "player" | "bot" | "away" | "timeout";

/** `auto` is true when the server made the move (a bot, a timeout, or an away player). */
export function moveBy(mover: { bot: boolean; away?: boolean }, auto: boolean): MoveBy {
	if (mover.bot) {
		return "bot";
	}

	if (!auto) {
		return "player";
	}

	return mover.away ? "away" : "timeout";
}

/** How a match ended: played to the end, or stopped by an admin terminating the table. */
export type MatchEnd = "finished" | "terminated";

/**
 * A finished match, as the platform's POST /v1/matches takes it. `score` is game-defined. A terminated match is
 * placed by the standings when it stopped, and counts no win.
 */
export type MatchReport = {
	matchId: string;
	game: string;
	roomCode: string;
	rulesVersion: number;
	startedAt: string;
	endedAt: string;
	endReason: MatchEnd;
	players: {
		seat: number;
		playerId: string | null;
		bot: boolean;
		botName?: string;
		placement: number;
		score: number;
	}[];
	log: { logVersion: number; events: LogEvent[] };
};

/**
 * Placements from a best-first order of players: 1, 2, 3, … with no shared place, so a terminated match still has
 * exactly one first place. Players the order leaves out are not expected.
 */
export function placementsInOrder(bestFirst: { id: string }[]): Map<string, number> {
	return new Map(bestFirst.map((player, index) => [player.id, index + 1]));
}

/** Gives new log entries their place and time. The clock may step back, so the elapsed time never goes below 0. */
export function stamp<M extends MatchState>(
	match: M,
	entries: LogEntry[],
	now: number,
): { match: M; events: LogEvent[] } {
	const elapsedMs = Math.max(0, now - Date.parse(match.startedAt));
	const events = entries.map((entry, index) => ({
		seq: match.seq + index,
		t: elapsedMs,
		...entry,
	}));

	return { match: { ...match, seq: match.seq + entries.length }, events };
}

/**
 * How a seat is reported. A bot a host added at an open table is a bot (`bot-…` id, no account). A bot account
 * the platform signed up for a tournament is a player like anyone: it reports under its own id, so its finish
 * counts in the tournament and its prize can be paid.
 */
export function reportedSeat(player: { id: string; name: string; bot: boolean }) {
	const tableBot = player.bot && player.id.startsWith("bot-");
	if (tableBot) {
		return { playerId: null, bot: true, botName: player.name };
	}

	return { playerId: player.id, bot: false };
}
