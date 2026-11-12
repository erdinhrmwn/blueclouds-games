import type { LogEntry, LogEvent, MatchReport, MatchState } from "../shared/match";
import { type Card, type Game, placements } from "./rules";

/** Bump when a rule change makes old results incomparable to new ones. */
export const RULES_VERSION = 1;
/** Bump when the shape of a log event changes (see docs/games/cloudburst/rules.md). */
export const LOG_VERSION = 1;

/** The result of a finished match: placed by points (fewest first), and each seat's points as its score. */
export function buildReport(
	match: MatchState,
	game: Game,
	roomCode: string,
	endedAt: string,
	events: LogEvent[],
): MatchReport {
	if (game.phase !== "finished" || !game.winnerId)
		throw new Error("buildReport needs a finished game");
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
			if (was && !!was.away !== !!p.away)
				entries.push({ type: p.away ? "away" : "back", seat: p.seat });
		}
	}
	if (after.moves === before.moves || after.phase === "lobby") return entries;

	const ev = after.lastEvent;
	const seatOf = (id: string) => after.players.find((p) => p.id === id)!.seat;
	const mover = before.phase === "playing" ? before.players[before.turn] : undefined;
	const by = !mover
		? "player"
		: mover.bot
			? "bot"
			: !auto
				? "player"
				: mover.away
					? "away"
					: "timeout";

	if (mover && (ev?.type === "played" || ev?.type === "roundEnd")) {
		const card = ev.card;
		const data: Record<string, unknown> = {
			card: card.id,
			left: ev.type === "roundEnd" ? 0 : after.players[before.turn]!.hand.length,
			by,
		};
		if (card.kind === "rainbow" && ev.type === "played") data.suit = after.suit;
		if (ev.type === "played" && ev.gaveTo) {
			const receiver = after.players.find((p) => p.id === ev.gaveTo)!;
			const had = before.players.find((p) => p.id === ev.gaveTo)!.hand;
			data.gave = receiver.hand.find((c) => !had.some((h) => h.id === c.id))?.id ?? null;
		}
		entries.push({ type: "play", seat: mover.seat, data });
	}
	if (mover && ev?.type === "drew") {
		if (before.deck.length === 0 && before.discard.length > 1)
			entries.push({
				type: "reshuffle",
				data: { deck: [...(after.drawnId ? [after.drawnId] : []), ...ids(after.deck)] },
			});
		entries.push({ type: "draw", seat: mover.seat, data: { card: after.drawnId, by } });
	}
	if (mover && ev?.type === "passed")
		entries.push({ type: "pass", seat: mover.seat, data: { by } });

	if (ev?.type === "roundEnd") {
		const left = Object.fromEntries(Object.entries(ev.gained).map(([id, n]) => [seatOf(id), n]));
		const points = Object.fromEntries(after.players.map((p) => [p.seat, p.points]));
		entries.push({ type: "round_end", data: { out: seatOf(ev.outId), left, points } });
	}
	if (after.phase === "playing" && (ev?.type === "dealt" || ev?.type === "roundEnd")) {
		const hands = Object.fromEntries(after.players.map((p) => [p.seat, ids(p.hand)]));
		const start = after.discard[0]!.id;
		entries.push({
			type: "deal",
			data: {
				round: after.round,
				starter: after.players[after.turn]!.seat,
				start,
				hands,
				deck: ids(after.deck),
			},
		});
	}
	if (after.phase === "finished") {
		const points = Object.fromEntries(after.players.map((p) => [p.seat, p.points]));
		entries.push({ type: "finished", data: { winner: seatOf(after.winnerId!), points } });
	}
	return entries;
}

const ids = (cards: Card[]) => cards.map((c) => c.id);
