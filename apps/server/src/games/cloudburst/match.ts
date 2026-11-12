import {
	type LogEntry,
	type LogEvent,
	type MatchReport,
	type MatchState,
	moveBy,
} from "../shared/match";
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
	if (game.phase !== "finished" || !game.winnerId) {
		throw new Error("buildReport needs a finished game");
	}

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

		if (card.kind === "rainbow" && event.type === "played") {
			data.suit = after.suit;
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
