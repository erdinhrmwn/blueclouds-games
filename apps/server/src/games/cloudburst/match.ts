import {
	reportedSeat,
	type LogEntry,
	type LogEvent,
	type MatchEnd,
	type MatchReport,
	type MatchState,
	moveBy,
	placementsInOrder,
} from "../shared/match";
import type { RoundResult } from "../shared/rounds";
import { type Card, type Game, placements } from "./rules";

/** Bump when a rule change makes old results incomparable to new ones. */
/** 2: Downpour (+2) and Tempest (+4) joined the deck. */
export const RULES_VERSION = 2;
/** Bump when the shape of a log event changes (see docs/games/cloudburst/rules.md). */
export const LOG_VERSION = 1;

/**
 * The result of a match: placed by points (fewest first), and each seat's points as its score. A terminated match
 * is placed the same way, with equal points split by seat so only one player places first.
 */
export function buildReport(
	match: MatchState,
	game: Game,
	roomCode: string,
	endedAt: string,
	events: LogEvent[],
	end: MatchEnd = "finished",
): MatchReport {
	if (end === "finished" && (game.phase !== "finished" || !game.winnerId)) {
		throw new Error("buildReport needs a finished game");
	}

	const place = end === "finished" ? placements(game) : standings(game);

	return {
		matchId: match.id,
		game: "cloudburst",
		roomCode,
		rulesVersion: RULES_VERSION,
		startedAt: match.startedAt,
		endedAt,
		endReason: end,
		players: game.players.map((p) => ({
			seat: p.seat,
			...reportedSeat(p),
			placement: place.get(p.id)!,
			score: p.points,
		})),
		log: { logVersion: LOG_VERSION, events },
	};
}

/** Where everyone stands mid-game: fewest points first, then by seat. */
function standings(game: Game): Map<string, number> {
	const bestFirst = [...game.players].sort((a, b) => a.points - b.points || a.seat - b.seat);

	return placementsInOrder(bestFirst);
}

/**
 * The log entries for one committed change of a running match, from the state before and after it.
 * `auto` is true when the server made the move (a bot, a timeout, or an away player).
 * Hands and deck order are included: the log only leaves the room once the match is over.
 */
export function logEvents(before: Game, after: Game, auto = false): LogEntry[] {
	const entries: LogEntry[] = awayChanges(before, after);
	if (after.moves === before.moves || after.phase === "lobby") return entries;

	const event = after.lastEvent;
	const seatOf = (id: string) => after.players.find((p) => p.id === id)!.seat;
	const mover = before.phase === "playing" ? before.players[before.turn] : undefined;
	const by = mover ? moveBy(mover, auto) : "player";

	if (mover && (event?.type === "played" || event?.type === "roundEnd")) {
		const card = event.card;
		const cardsLeft = event.type === "roundEnd" ? 0 : after.players[before.turn]!.hand.length;
		const data: Record<string, unknown> = { card: card.id, left: cardsLeft, by };

		if (card.suit === null && event.type === "played") {
			data.suit = after.suit;
		}

		if (event.type === "played" && event.forced !== undefined && event.skipped) {
			const victim = before.players.find((p) => p.id === event.skipped)!;
			const now = after.players.find((p) => p.id === event.skipped)!;
			// The drawn cards are appended in draw order.
			const forcedCards = ids(now.hand.slice(victim.hand.length));
			const fromOldDeck = Math.min(before.deck.length, forcedCards.length);
			if (fromOldDeck < forcedCards.length) {
				// The deck ran out mid-draw: everything under the top card was shuffled into a new one.
				const fromNewDeck = forcedCards.slice(fromOldDeck);
				entries.push({ type: "reshuffle", data: { deck: [...fromNewDeck, ...ids(after.deck)] } });
			}
			data.forced = { seat: victim.seat, cards: forcedCards };
		}

		if (event.type === "played" && event.gaveTo) {
			const receiver = after.players.find((p) => p.id === event.gaveTo)!;
			const had = before.players.find((p) => p.id === event.gaveTo)!.hand;
			const given = receiver.hand.find((held) => !had.some((old) => old.id === held.id));
			data.gave = given?.id ?? null;
		}

		entries.push({ type: "play", seat: mover.seat, data });
	}

	if (mover && event?.type === "drew") {
		if (before.deck.length === 0 && before.discard.length > 1) {
			const drawnCard = after.drawnId ? [after.drawnId] : [];
			entries.push({ type: "reshuffle", data: { deck: [...drawnCard, ...ids(after.deck)] } });
		}

		entries.push({ type: "draw", seat: mover.seat, data: { card: after.drawnId, by } });
	}

	if (mover && event?.type === "passed") {
		entries.push({ type: "pass", seat: mover.seat, data: { by } });
	}

	if (event?.type === "roundEnd") {
		const gainedBySeat = Object.entries(event.gained).map(([id, count]) => [seatOf(id), count]);
		const left = Object.fromEntries(gainedBySeat);
		const points = Object.fromEntries(after.players.map((p) => [p.seat, p.points]));
		entries.push({ type: "round_end", data: { out: seatOf(event.outId), left, points } });
	}

	const newRound = event?.type === "dealt" || event?.type === "roundEnd";
	if (after.phase === "playing" && newRound) {
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

/** "away" / "back" entries for players whose away flag changed mid-match. */
function awayChanges(before: Game, after: Game): LogEntry[] {
	if (before.phase !== "playing") return [];

	const entries: LogEntry[] = [];
	for (const player of after.players) {
		const was = before.players.find((p) => p.id === player.id);
		if (was && !!was.away !== !!player.away) {
			entries.push({ type: player.away ? "away" : "back", seat: player.seat });
		}
	}

	return entries;
}

const ids = (cards: Card[]) => cards.map((card) => card.id);

/** A Cloudburst round's summary: the seat that went out, the cards each seat was left with and the points. */
export const roundResult: RoundResult = (events) => {
	const end = events.find((event) => event.type === "round_end");

	return end?.data ?? {};
};
