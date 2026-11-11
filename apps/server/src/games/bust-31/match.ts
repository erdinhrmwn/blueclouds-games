import type { Card, Game, Player } from "./rules";
import type { LogEntry, LogEvent, MatchReport, MatchState as SharedMatch } from "../shared/match";

/** Bump when a rule change makes old results incomparable to new ones. */
export const RULES_VERSION = 1;
/** Bump when the shape of a log event changes (see docs/architecture/match-log.md). */
export const LOG_VERSION = 1;

/** The game in progress. `out` lists player ids in the order they were eliminated. */
export type MatchState = SharedMatch & { out: string[] };

/** Notes who lost their last life on the move that produced `game`. Call after every move. */
export function noteMove(match: MatchState, game: Game): MatchState {
	const out = game.players.filter((p) => p.lives <= 0 && !match.out.includes(p.id)).map((p) => p.id);
	return out.length ? { ...match, out: [...match.out, ...out] } : match;
}

/** The result of a finished game: the winner places 1st, the last one out 2nd, and so on. */
export function buildReport(match: MatchState, game: Game, roomCode: string, endedAt: string, events: LogEvent[]): MatchReport {
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
			score: Math.max(0, p.lives), // Bust 31 scores lives left
		})),
		log: { logVersion: LOG_VERSION, events },
	};
}

/**
 * The log entries for one committed change of a running match, from the state before and after it.
 * `auto` is true when the server made the move (a bot, a timeout, or an away player).
 * Hands and deck order are included: the log only leaves the room once the match is over.
 */
export function logEvents(before: Game, after: Game, auto = false): LogEntry[] {
	const entries: LogEntry[] = [];
	if (before.phase === "playing") {
		for (const p of after.players) {
			const was = before.players.find((b) => b.id === p.id);
			if (was && !!was.away !== !!p.away) entries.push({ type: p.away ? "away" : "back", seat: p.seat });
		}
	}
	if (after.moves === before.moves || after.phase === "lobby") return entries;

	const ev = after.lastEvent;
	const mover = before.phase === "playing" ? before.players[before.turn] : undefined;
	if (mover && ev?.type !== "started") {
		const now = after.players.find((p) => p.id === mover.id)!;
		const by = mover.bot ? "bot" : !auto ? "player" : mover.away ? "away" : "timeout";
		// "finished" replaces the bust in lastEvent; the card is then the one that left the hand.
		const card = ev?.type === "played" || ev?.type === "bust" ? ev.card : missing(mover.hand, now.hand);
		if (ev?.type === "played") {
			if (before.deck.length === 0) entries.push({ type: "reshuffle", data: { deck: [...drawn(mover, now), ...ids(after.deck)] } });
			entries.push({ type: "play", seat: mover.seat, data: { card: card.id, total: after.total, drew: drawn(mover, now)[0] ?? null, by } });
		} else {
			const total = ev?.type === "bust" ? ev.total : after.total;
			entries.push({ type: "bust", seat: mover.seat, data: { card: card.id, total, lives: Math.max(0, now.lives), eliminated: now.lives <= 0, by } });
		}
	}
	if (after.phase === "playing" && (ev?.type === "started" || ev?.type === "bust")) {
		const hands = Object.fromEntries(after.players.filter((p) => p.lives > 0).map((p) => [p.seat, ids(p.hand)]));
		entries.push({ type: "deal", data: { round: after.round, starter: after.players[after.turn]!.seat, hands, deck: ids(after.deck) } });
	}
	if (after.phase === "finished") {
		entries.push({ type: "finished", data: { winner: after.players.find((p) => p.id === after.winnerId)!.seat } });
	}
	return entries;
}

const ids = (cards: Card[]) => cards.map((c) => c.id);
/** The card in `from` that is not in `to` (the one just played, when no new hand was dealt). */
const missing = (from: Card[], to: Card[]) => from.find((c) => !to.some((x) => x.id === c.id))!;
/** The card a player drew after playing: in their new hand but not their old one. */
const drawn = (before: Player, after: Player) => ids(after.hand.filter((c) => !before.hand.some((x) => x.id === c.id)));
